#import <React/RCTBridgeModule.h>
#import <AppKit/AppKit.h>

@interface DependencyStatus : NSObject <RCTBridgeModule>
@end

/// Same path as RCTEventEmitter: JS listens on DeviceEventEmitter ("RCTDeviceEventEmitter").
static void EmitConversionProgressToJS(RCTCallableJSModules *_Nullable jsModules,
                                     NSInteger cur,
                                     NSInteger tot,
                                     NSString *kind)
{
  if (jsModules == nil || tot <= 0 || cur < 0) {
    return;
  }
  NSDictionary *body = @{@"current" : @(cur), @"total" : @(tot), @"kind" : (kind.length > 0 ? kind : @"whisper")};
  RCTCallableJSModules *caller = jsModules;
  dispatch_async(dispatch_get_main_queue(), ^{
    [caller invokeModule:@"RCTDeviceEventEmitter"
                  method:@"emit"
                withArgs:@[ @"WhisperScanProgress", body ]];
  });
}

/// Merge: chapter or file progress stream; see merge_mp3_chapters.py — [ch:3:32:marks]
static void EmitMergeChapterTagToJS(RCTCallableJSModules *_Nullable jsModules,
                                   NSInteger chapterCur,
                                   NSInteger chapterTot,
                                   NSString *mode)
{
  if (jsModules == nil || chapterTot <= 0 || chapterCur < 1) {
    return;
  }
  NSDictionary *body = @{
    @"kind" : @"merge",
    @"chapterCurrent" : @(chapterCur),
    @"chapterTotal" : @(chapterTot),
    @"chapterMode" : (mode.length > 0 ? mode : @"marks"),
  };
  RCTCallableJSModules *caller = jsModules;
  dispatch_async(dispatch_get_main_queue(), ^{
    [caller invokeModule:@"RCTDeviceEventEmitter"
                  method:@"emit"
                withArgs:@[ @"WhisperScanProgress", body ]];
  });
}

static void ParseMergeChapterTagLine(NSString *line, RCTCallableJSModules *_Nullable jsModules)
{
  static NSRegularExpression *re = nil;
  static dispatch_once_t chOnce;
  dispatch_once(&chOnce, ^{
    re = [NSRegularExpression regularExpressionWithPattern:@"\\[ch:(\\d+):(\\d+):(\\w+)\\]"
                                                   options:0
                                                     error:NULL];
  });
  if (re == nil || line.length == 0) {
    return;
  }
  NSString *trimmed =
      [line stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  NSTextCheckingResult *match =
      [re firstMatchInString:trimmed options:0 range:NSMakeRange(0, trimmed.length)];
  if (!match || match.numberOfRanges < 4) {
    return;
  }
  NSInteger cur = [[trimmed substringWithRange:[match rangeAtIndex:1]] integerValue];
  NSInteger tot = [[trimmed substringWithRange:[match rangeAtIndex:2]] integerValue];
  NSString *mode = [trimmed substringWithRange:[match rangeAtIndex:3]];
  if (tot <= 0 || cur < 1 || cur > tot) {
    return;
  }
  EmitMergeChapterTagToJS(jsModules, cur, tot, [mode lowercaseString]);
}

static void ParseBracketProgressLine(NSString *line,
                                  RCTCallableJSModules *_Nullable jsModules,
                                  NSString *kind)
{
  static NSRegularExpression *re = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    re = [NSRegularExpression regularExpressionWithPattern:@"\\[(\\d+)/(\\d+)\\]"
                                                   options:0
                                                     error:NULL];
  });
  if (re == nil || line.length == 0) {
    return;
  }
  NSString *trimmed =
      [line stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (trimmed.length == 0) {
    return;
  }
  NSTextCheckingResult *match =
      [re firstMatchInString:trimmed options:0 range:NSMakeRange(0, trimmed.length)];
  if (!match || match.numberOfRanges < 3) {
    return;
  }
  NSInteger cur = [[trimmed substringWithRange:[match rangeAtIndex:1]] integerValue];
  NSInteger tot = [[trimmed substringWithRange:[match rangeAtIndex:2]] integerValue];
  if (tot <= 0 || cur < 0) {
    return;
  }
  EmitConversionProgressToJS(jsModules, cur, tot, kind);
}

static void DrainStderrLinesFromBuffer(NSMutableData *buffer,
                                       NSMutableString *stderrAccum,
                                       RCTCallableJSModules *_Nullable jsModules,
                                       NSString *progressKind)
{
  while (buffer.length > 0) {
    const uint8_t *b = (const uint8_t *)buffer.bytes;
    NSUInteger n = buffer.length;
    NSUInteger lineEnd = NSNotFound;
    for (NSUInteger i = 0; i < n; i++) {
      if (b[i] == '\n') {
        lineEnd = i;
        break;
      }
    }
    if (lineEnd == NSNotFound) {
      break;
    }
    NSData *lineData = [buffer subdataWithRange:NSMakeRange(0, lineEnd)];
    [buffer replaceBytesInRange:NSMakeRange(0, lineEnd + 1) withBytes:NULL length:0];
    NSString *line = [[NSString alloc] initWithData:lineData encoding:NSUTF8StringEncoding];
    if (line.length == 0) {
      continue;
    }
    [stderrAccum appendString:line];
    [stderrAccum appendString:@"\n"];
    ParseMergeChapterTagLine(line, jsModules);
    ParseBracketProgressLine(line, jsModules, progressKind);
  }
}

/// Stdout als NSString; Stderr zeilenweise (Fortschritt [i/n] → JS Event).
static NSString *_Nullable RunShellSeparatingStdoutStreamingStderr(NSString *command,
                                                                   NSMutableString *stderrAccum,
                                                                   int *exitStatusOut,
                                                                   RCTCallableJSModules *_Nullable jsModules,
                                                                   NSString *progressKind)
{
  if (exitStatusOut != NULL) {
    *exitStatusOut = -1;
  }
  @try {
    NSTask *task = [[NSTask alloc] init];
    [task setLaunchPath:@"/bin/sh"];
    [task setArguments:@[ @"-c", command ]];
    NSPipe *outPipe = [NSPipe pipe];
    NSPipe *errPipe = [NSPipe pipe];
    [task setStandardOutput:outPipe];
    [task setStandardError:errPipe];
    NSFileHandle *errRead = [errPipe fileHandleForReading];
    NSMutableData *errBuf = [NSMutableData data];

    [task launch];

    // readDataOfLength: blocks until N bytes or EOF — stderr lines would only arrive at end.
    // availableData returns whatever bytes are ready (after each line with flush).
    while (YES) {
      @autoreleasepool {
        NSData *chunk = [errRead availableData];
        if (chunk.length > 0) {
          [errBuf appendData:chunk];
          DrainStderrLinesFromBuffer(errBuf, stderrAccum, jsModules, progressKind);
        }
        if (![task isRunning] && chunk.length == 0) {
          break;
        }
      }
    }

    [task waitUntilExit];
    if (exitStatusOut != NULL) {
      *exitStatusOut = (int)[task terminationStatus];
    }
    if (errBuf.length > 0) {
      NSString *rest = [[NSString alloc] initWithData:errBuf encoding:NSUTF8StringEncoding];
      if (rest.length > 0) {
        [stderrAccum appendString:rest];
        ParseMergeChapterTagLine(rest, jsModules);
        ParseBracketProgressLine(rest, jsModules, progressKind);
      }
    }

    NSData *outData = [[outPipe fileHandleForReading] readDataToEndOfFile];
    return [[NSString alloc] initWithData:outData encoding:NSUTF8StringEncoding] ?: @"";
  } @catch (__unused NSException *exception) {
    return nil;
  }
}

/// Full multi-line output for update logs
static NSString *_Nullable RunShellFull(NSString *command)
{
  @try {
    NSTask *task = [[NSTask alloc] init];
    [task setLaunchPath:@"/bin/sh"];
    [task setArguments:@[ @"-c", command ]];
    NSPipe *pipe = [NSPipe pipe];
    [task setStandardOutput:pipe];
    [task setStandardError:pipe];
    [task launch];
    [task waitUntilExit];
    NSData *data = [[pipe fileHandleForReading] readDataToEndOfFile];
    return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @"";
  } @catch (__unused NSException *exception) {
    return nil;
  }
}

/// Stdout und Stderr getrennt (z. B. JSON nur in stdout).
static NSString *_Nullable RunShellSeparatingStdout(NSString *command,
                                                    NSString *_Nullable *stderrOut,
                                                    int *exitStatusOut)
{
  if (stderrOut != NULL) {
    *stderrOut = nil;
  }
  if (exitStatusOut != NULL) {
    *exitStatusOut = -1;
  }
  @try {
    NSTask *task = [[NSTask alloc] init];
    [task setLaunchPath:@"/bin/sh"];
    [task setArguments:@[ @"-c", command ]];
    NSPipe *outPipe = [NSPipe pipe];
    NSPipe *errPipe = [NSPipe pipe];
    [task setStandardOutput:outPipe];
    [task setStandardError:errPipe];
    [task launch];
    [task waitUntilExit];
    if (exitStatusOut != NULL) {
      *exitStatusOut = (int)[task terminationStatus];
    }
    NSData *outData = [[outPipe fileHandleForReading] readDataToEndOfFile];
    NSData *errData = [[errPipe fileHandleForReading] readDataToEndOfFile];
    if (stderrOut != NULL) {
      *stderrOut = [[NSString alloc] initWithData:errData encoding:NSUTF8StringEncoding] ?: @"";
    }
    return [[NSString alloc] initWithData:outData encoding:NSUTF8StringEncoding] ?: @"";
  } @catch (__unused NSException *exception) {
    return nil;
  }
}

static NSString *_Nullable RunShell(NSString *command)
{
  NSString *full = RunShellFull(command);
  if (!full) {
    return nil;
  }
  return [full stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
}

static void AppendLog(NSMutableString *log, NSString *title, NSString *_Nullable output)
{
  [log appendFormat:@"— %@ —\n", title];
  if (output.length > 0) {
    [log appendString:output];
    if (![output hasSuffix:@"\n"]) {
      [log appendString:@"\n"];
    }
  } else {
    [log appendString:@"(no output)\n"];
  }
  [log appendString:@"\n"];
}

static NSString *ShellQuotePath(NSString *path)
{
  NSString *escaped = [path stringByReplacingOccurrencesOfString:@"'" withString:@"'\\''"];
  return [NSString stringWithFormat:@"'%@'", escaped];
}

/// `<stdRoot>/<sanitized last path component>.m4b` — mirrors the user's chosen folder name.
static NSString *AUBKM4bOutputPathForProjectFolder(NSString *stdRoot)
{
  NSString *last = [stdRoot lastPathComponent];
  NSMutableString *base =
      [NSMutableString stringWithString:(last.length > 0 ? last : @"AudiobookConverter")];
  NSCharacterSet *forbidden =
      [NSCharacterSet characterSetWithCharactersInString:@"/:\0"];
  for (NSInteger i = (NSInteger)base.length - 1; i >= 0; i--) {
    unichar c = [base characterAtIndex:(NSUInteger)i];
    if ([forbidden characterIsMember:c]) {
      [base replaceCharactersInRange:NSMakeRange((NSUInteger)i, 1) withString:@"-"];
    }
  }
  NSString *trimmed =
      [base stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (trimmed.length == 0 || [trimmed isEqualToString:@"."] || [trimmed isEqualToString:@".."]) {
    trimmed = @"AudiobookConverter";
  }
  if (trimmed.length > 200) {
    trimmed = [trimmed substringToIndex:200];
  }
  return [[stdRoot stringByAppendingPathComponent:trimmed] stringByAppendingPathExtension:@"m4b"];
}

#ifndef AUDIOBOOK_PROJECT_ROOT
#error AUDIOBOOK_PROJECT_ROOT must be set (Xcode: GCC_PREPROCESSOR_DEFINITIONS, $(SRCROOT)/..)
#endif

/// Repo-Wurzel: Build-Flag $(SRCROOT)/.. (Ordner „macos“ → Elternverzeichnis). venv: <Repo>/.audioBookConverter
static NSString *AppProjectRoot(void)
{
  return [AUDIOBOOK_PROJECT_ROOT stringByStandardizingPath];
}

static NSString *AppVenvRoot(void)
{
  return [[AppProjectRoot() stringByAppendingPathComponent:@".audioBookConverter"] stringByStandardizingPath];
}

/// venvRoot = venv directory (contains bin/python3). nil/empty → system "python3"
static NSString *PythonExecutableToken(NSString *_Nullable venvRoot)
{
  if (venvRoot == nil || venvRoot.length == 0) {
    return @"python3";
  }
  NSString *root = [venvRoot stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (root.length == 0) {
    return @"python3";
  }
  NSFileManager *fm = [NSFileManager defaultManager];
  NSString *py3 = [root stringByAppendingPathComponent:@"bin/python3"];
  if ([fm isExecutableFileAtPath:py3]) {
    return ShellQuotePath(py3);
  }
  NSString *py = [root stringByAppendingPathComponent:@"bin/python"];
  if ([fm isExecutableFileAtPath:py]) {
    return ShellQuotePath(py);
  }
  return ShellQuotePath(py3);
}

static int ParseFirstIntAfterDot(NSString *versionTail)
{
  NSArray *parts = [versionTail componentsSeparatedByString:@"."];
  if (parts.count < 1) {
    return -1;
  }
  return [parts[0] intValue];
}

/// faster-whisper ist in der Praxis auf macOS mit Python 3.10-3.12 am stabilsten.
static BOOL IsSupportedPythonForFasterWhisper(int major, int minor)
{
  if (major != 3) {
    return NO;
  }
  return minor >= 10 && minor <= 12;
}

/// Preferred interpreter for creating venv if present, else "python3".
static NSString *PreferredSystemPythonForVenv(void)
{
  NSFileManager *fm = [NSFileManager defaultManager];
  NSArray<NSString *> *candidates = @[
    @"/opt/homebrew/bin/python3.12",
    @"/usr/local/bin/python3.12",
    @"/opt/homebrew/bin/python3.11",
    @"/usr/local/bin/python3.11",
    @"/opt/homebrew/bin/python3.10",
    @"/usr/local/bin/python3.10",
  ];
  for (NSString *p in candidates) {
    if ([fm isExecutableFileAtPath:p]) {
      return ShellQuotePath(p);
    }
  }
  return @"python3";
}

static NSString *CheckPython(NSString *pyExe)
{
  NSString *cmd = [NSString stringWithFormat:@"%@ --version 2>&1", pyExe];
  NSString *out = RunShell(cmd);
  if (!out || out.length == 0) {
    return @"missing";
  }
  NSString *t = [out lowercaseString];
  if (![t hasPrefix:@"python"]) {
    return @"wrong_version";
  }
  NSRange r = [t rangeOfString:@"python "];
  if (r.location == NSNotFound) {
    return @"wrong_version";
  }
  NSString *after = [t substringFromIndex:NSMaxRange(r)];
  NSArray *segs = [after componentsSeparatedByString:@"."];
  if (segs.count < 2) {
    return @"wrong_version";
  }
  int major = [segs[0] intValue];
  int minor = [segs[1] intValue];
  if (IsSupportedPythonForFasterWhisper(major, minor)) {
    return @"ok";
  }
  return @"wrong_version";
}

static NSString *CheckPip(NSString *pyExe)
{
  NSString *cmd = [NSString stringWithFormat:@"%@ -m pip --version 2>&1", pyExe];
  NSString *out = RunShell(cmd);
  if (!out || out.length < 5) {
    return @"missing";
  }
  NSString *t = [out stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  NSRange r = [t rangeOfString:@"pip "];
  if (r.location == NSNotFound) {
    return @"wrong_version";
  }
  NSString *rest = [t substringFromIndex:NSMaxRange(r)];
  NSScanner *scanner = [NSScanner scannerWithString:rest];
  double major = 0;
  if (![scanner scanDouble:&major]) {
    return @"wrong_version";
  }
  /// Minimum pip version (major.minor from first token), e.g. 26.0.0 → major ≥ 26
  if (major >= 26.0) {
    return @"ok";
  }
  return @"wrong_version";
}

/// Ohne Terminal hat die GUI-App meist kein Homebrew im PATH — ffmpeg sonst „missing“, obwohl installiert.
static NSString *_Nullable FfmpegExecutablePath(void)
{
  NSFileManager *fm = [NSFileManager defaultManager];
  if ([fm isExecutableFileAtPath:@"/opt/homebrew/bin/ffmpeg"]) {
    return @"/opt/homebrew/bin/ffmpeg";
  }
  if ([fm isExecutableFileAtPath:@"/usr/local/bin/ffmpeg"]) {
    return @"/usr/local/bin/ffmpeg";
  }
  NSString *p = RunShell(
      @"export PATH=\"/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin\"; command -v ffmpeg");
  return p.length > 0 ? p : nil;
}

static NSString *CheckFfmpeg(void)
{
  NSString *ffmpeg = FfmpegExecutablePath();
  if (ffmpeg.length == 0) {
    return @"missing";
  }
  NSString *out = RunShell(
      [NSString stringWithFormat:@"%@ -version 2>&1 | head -n 1", ShellQuotePath(ffmpeg)]);
  if (!out || out.length < 8) {
    return @"missing";
  }
  NSString *t = [out stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (![t hasPrefix:@"ffmpeg version"]) {
    return @"missing";
  }
  NSRange r = [t rangeOfString:@"ffmpeg version "];
  if (r.location == NSNotFound) {
    return @"wrong_version";
  }
  NSString *ver = [[t substringFromIndex:NSMaxRange(r)] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
  NSArray *parts = [ver componentsSeparatedByCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@" -"]];
  if (parts.count < 1 || [parts[0] length] == 0) {
    return @"wrong_version";
  }
  int major = ParseFirstIntAfterDot(parts[0]);
  if (major >= 4) {
    return @"ok";
  }
  if (major >= 0) {
    return @"wrong_version";
  }
  return @"missing";
}

static NSString *CheckFasterWhisper(NSString *pyExe)
{
  NSString *cmd = [NSString stringWithFormat:@"%@ -m pip show faster-whisper 2>&1", pyExe];
  NSString *out = RunShell(cmd);
  if (!out || [out rangeOfString:@"Name: faster-whisper"].location == NSNotFound) {
    return @"missing";
  }
  NSArray *lines = [out componentsSeparatedByString:@"\n"];
  for (NSString *line in lines) {
    if ([line hasPrefix:@"Version:"]) {
      NSString *v = [[line substringFromIndex:8] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
      NSArray *segs = [v componentsSeparatedByString:@"."];
      if (segs.count >= 2) {
        int major = [segs[0] intValue];
        int minor = [segs[1] intValue];
        if (major > 0 || minor >= 10) {
          return @"ok";
        }
      }
      return @"wrong_version";
    }
  }
  return @"ok";
}

static NSString *_Nullable BrewExecutablePath(void)
{
  NSFileManager *fm = [NSFileManager defaultManager];
  if ([fm isExecutableFileAtPath:@"/opt/homebrew/bin/brew"]) {
    return @"/opt/homebrew/bin/brew";
  }
  if ([fm isExecutableFileAtPath:@"/usr/local/bin/brew"]) {
    return @"/usr/local/bin/brew";
  }
  NSString *which = RunShell(@"command -v brew");
  return which.length > 0 ? which : nil;
}

/// Executable venv Python as sh token, else reject and nil.
static NSString *_Nullable VenvPythonTokenOrReject(NSFileManager *fm,
                                                    NSString *venv,
                                                    RCTPromiseRejectBlock reject)
{
  NSString *py3 = [venv stringByAppendingPathComponent:@"bin/python3"];
  if ([fm isExecutableFileAtPath:py3]) {
    return ShellQuotePath(py3);
  }
  NSString *py = [venv stringByAppendingPathComponent:@"bin/python"];
  if ([fm isExecutableFileAtPath:py]) {
    return ShellQuotePath(py);
  }
  reject(@"no_venv",
         @"No Python in the project venv (.audioBookConverter in the repo). Tap Install for Python first.",
         nil);
  return nil;
}

static void RunSingleDependency(NSString *key,
                                NSString *action,
                                NSMutableString *log,
                                RCTPromiseResolveBlock resolve,
                                RCTPromiseRejectBlock reject)
{
  NSString *venv = AppVenvRoot();
  NSFileManager *fm = [NSFileManager defaultManager];
  NSString *py3path = [venv stringByAppendingPathComponent:@"bin/python3"];
  BOOL install = [action isEqualToString:@"install"];
  BOOL update = [action isEqualToString:@"update"];

  if ([key isEqualToString:@"python"]) {
    if (install) {
      if ([fm isExecutableFileAtPath:py3path]) {
        AppendLog(log, @"Python", @"venv already exists.\n");
      } else {
        NSString *venvPython = PreferredSystemPythonForVenv();
        NSString *createCmd =
            [NSString stringWithFormat:@"%@ -m venv %@", venvPython, ShellQuotePath(venv)];
        AppendLog(log, @"venv Python", [NSString stringWithFormat:@"%@\n", venvPython]);
        AppendLog(log, @"Create venv", RunShellFull(createCmd));
        if (![fm isExecutableFileAtPath:py3path]) {
          reject(@"python",
                 @"Could not create the project venv (.audioBookConverter). Is python3 on PATH?",
                 nil);
          return;
        }
      }
    } else if (update) {
      NSString *brew = BrewExecutablePath();
      if (brew != nil) {
        AppendLog(log, @"Python (Homebrew)",
                  RunShellFull([NSString stringWithFormat:@"%@ upgrade python 2>&1", ShellQuotePath(brew)]));
      } else {
        AppendLog(log, @"Homebrew", @"Not found — please update Python manually.\n");
      }
      AppendLog(log, @"Note",
                @"After a Python upgrade you may delete the .audioBookConverter folder in the project and run "
                @"Install for Python again to recreate the venv.\n");
    } else {
      reject(@"bad_action", @"Unknown action.", nil);
      return;
    }
  } else if ([key isEqualToString:@"pip"]) {
    NSString *py = VenvPythonTokenOrReject(fm, venv, reject);
    if (!py) {
      return;
    }
    if (install) {
      AppendLog(log, @"ensurepip", RunShellFull([NSString stringWithFormat:@"%@ -m ensurepip --upgrade 2>&1", py]));
    }
    AppendLog(log, @"pip",
              RunShellFull([NSString stringWithFormat:@"%@ -m pip install --upgrade pip 2>&1", py]));
  } else if ([key isEqualToString:@"ffmpeg"]) {
    NSString *brew = BrewExecutablePath();
    if (!brew) {
      reject(@"no_brew", @"Homebrew not found — please install ffmpeg manually.", nil);
      return;
    }
    NSString *bq = ShellQuotePath(brew);
    if (install) {
      AppendLog(log, @"ffmpeg install", RunShellFull([NSString stringWithFormat:@"%@ install ffmpeg 2>&1", bq]));
    } else if (update) {
      AppendLog(log, @"ffmpeg upgrade", RunShellFull([NSString stringWithFormat:@"%@ upgrade ffmpeg 2>&1", bq]));
    } else {
      reject(@"bad_action", @"Unknown action.", nil);
      return;
    }
  } else if ([key isEqualToString:@"fasterWhisper"]) {
    NSString *py = VenvPythonTokenOrReject(fm, venv, reject);
    if (!py) {
      return;
    }
    if (install) {
      AppendLog(log, @"faster-whisper install",
                RunShellFull([NSString stringWithFormat:@"%@ -m pip install faster-whisper 2>&1", py]));
    } else if (update) {
      AppendLog(log, @"faster-whisper upgrade",
                RunShellFull([NSString stringWithFormat:@"%@ -m pip install -U faster-whisper 2>&1", py]));
    } else {
      reject(@"bad_action", @"Unknown action.", nil);
      return;
    }
  } else {
    reject(@"bad_key", @"Unknown dependency.", nil);
    return;
  }

  resolve(@{@"log" : [log copy]});
}

static void CountMp3FilesInDirectoryResolved(NSString *dirPath,
                                             RCTPromiseResolveBlock resolve,
                                             RCTPromiseRejectBlock reject)
{
  NSFileManager *fm = [NSFileManager defaultManager];
  BOOL isDir = NO;
  if (![fm fileExistsAtPath:dirPath isDirectory:&isDir]) {
    reject(@"enoent", @"The directory does not exist.", nil);
    return;
  }
  if (!isDir) {
    reject(@"notdir", @"The path is not a directory.", nil);
    return;
  }
  NSURL *root = [NSURL fileURLWithPath:dirPath isDirectory:YES];
  NSDirectoryEnumerator *en =
      [fm enumeratorAtURL:root
        includingPropertiesForKeys:@[NSURLIsRegularFileKey]
                   options:NSDirectoryEnumerationSkipsPackageDescendants |
                           NSDirectoryEnumerationSkipsHiddenFiles
              errorHandler:^BOOL(NSURL *_Nonnull url, NSError *_Nonnull error) {
                return YES;
              }];
  NSUInteger count = 0;
  for (NSURL *url in en) {
    NSNumber *isFile = nil;
    [url getResourceValue:&isFile forKey:NSURLIsRegularFileKey error:nil];
    if (isFile.boolValue) {
      NSString *lower = url.lastPathComponent.lowercaseString;
      if ([lower hasSuffix:@".mp3"]) {
        count++;
      }
    }
  }
  resolve(@(count));
}

static NSSet *WhisperModelSizes(void)
{
  return [NSSet setWithArray:@[ @"tiny", @"base", @"small", @"medium", @"large" ]];
}

static BOOL ValidateWhisperParams(NSString *modelSize,
                                 NSString *device,
                                 NSString *computeType,
                                 RCTPromiseRejectBlock reject)
{
  NSString *ms = modelSize.lowercaseString;
  NSString *dev = device.lowercaseString;
  NSString *ct = computeType.lowercaseString;
  if (![WhisperModelSizes() containsObject:ms]) {
    reject(@"bad_model",
           @"Invalid model size. Allowed: tiny, base, small, medium, large.",
           nil);
    return NO;
  }
  if (![dev isEqualToString:@"cpu"] && ![dev isEqualToString:@"cuda"]) {
    reject(@"bad_device", @"Invalid device. Allowed: cpu, cuda.", nil);
    return NO;
  }
  if (![ct isEqualToString:@"int8"]) {
    reject(@"bad_compute", @"Only compute_type \"int8\" is supported.", nil);
    return NO;
  }
  return YES;
}

static void DetectChaptersWithWhisperResolved(NSString *rootDir,
                                           NSString *modelSize,
                                           NSString *device,
                                           NSString *computeType,
                                           RCTCallableJSModules *_Nullable jsModulesForProgress,
                                           RCTPromiseResolveBlock resolve,
                                           RCTPromiseRejectBlock reject)
{
  if (!ValidateWhisperParams(modelSize, device, computeType, reject)) {
    return;
  }
  NSString *ms = modelSize.lowercaseString;
  NSString *dev = device.lowercaseString;
  NSString *ct = computeType.lowercaseString;

  NSFileManager *fm = [NSFileManager defaultManager];
  BOOL isDir = NO;
  if (![fm fileExistsAtPath:rootDir isDirectory:&isDir]) {
    reject(@"enoent", @"The project directory does not exist.", nil);
    return;
  }
  if (!isDir) {
    reject(@"notdir", @"The path is not a directory.", nil);
    return;
  }

  NSString *ffmpeg = FfmpegExecutablePath();
  if (ffmpeg == nil || ffmpeg.length == 0) {
    reject(@"no_ffmpeg",
           @"ffmpeg is required (first 45 s per MP3 for Whisper). Install it or check PATH.",
           nil);
    return;
  }

  NSString *venv = AppVenvRoot();
  NSString *py = VenvPythonTokenOrReject(fm, venv, reject);
  if (!py) {
    return;
  }
  NSString *script =
      [[AppProjectRoot() stringByAppendingPathComponent:@"scripts"] stringByAppendingPathComponent:@"whisper_chapter_scan.py"];
  if (![fm isReadableFileAtPath:script]) {
    reject(@"no_script", @"scripts/whisper_chapter_scan.py not found in the project.", nil);
    return;
  }

  /// PYTHONUNBUFFERED: stderr lines flush immediately; otherwise progress stays buffered until exit.
  NSString *cmd =
      [NSString stringWithFormat:
           @"env PYTHONUNBUFFERED=1 %@ %@ --root-dir %@ --model-size %@ --device %@ --compute-type %@ "
           @"--ffmpeg %@ --head-seconds 45",
           py,
           ShellQuotePath(script),
           ShellQuotePath(rootDir),
           ShellQuotePath(ms),
           ShellQuotePath(dev),
           ShellQuotePath(ct),
           ShellQuotePath(ffmpeg)];
  int status = -1;
  NSMutableString *stderrAll = [NSMutableString string];
  NSString *stdoutStr = RunShellSeparatingStdoutStreamingStderr(
      cmd, stderrAll, &status, jsModulesForProgress, @"whisper");
  NSString *stderrTxt = [stderrAll copy];
  if (stdoutStr == nil) {
    reject(@"run_failed", @"Whisper chapter scan could not be started (shell error).", nil);
    return;
  }
  if (status != 0) {
    NSMutableString *detail = [NSMutableString string];
    if (stderrTxt.length > 0) {
      [detail appendString:stderrTxt];
    }
    if (detail.length == 0 && stdoutStr.length > 0) {
      [detail appendString:stdoutStr];
    }
    if (detail.length == 0) {
      [detail appendString:@"(no output)"];
    }
    if (detail.length > 2000) {
      [detail deleteCharactersInRange:NSMakeRange(2000, detail.length - 2000)];
      [detail appendString:@"…"];
    }
    reject(@"whisper_failed",
           [NSString stringWithFormat:@"Whisper transcription / chapter scan failed:\n%@", detail],
           nil);
    return;
  }

  NSString *trimmed = [stdoutStr stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  NSData *jsonData = [trimmed dataUsingEncoding:NSUTF8StringEncoding];
  if (!jsonData || trimmed.length == 0) {
    reject(@"json", @"Could not read output from whisper_chapter_scan.py.", nil);
    return;
  }
  NSError *err = nil;
  id obj = [NSJSONSerialization JSONObjectWithData:jsonData options:0 error:&err];
  if (![obj isKindOfClass:[NSDictionary class]] || err != nil) {
    reject(@"json", @"Invalid JSON from whisper_chapter_scan.py.", err);
    return;
  }
  NSDictionary *dict = (NSDictionary *)obj;
  id marks = dict[@"marks"];
  if (![marks isKindOfClass:[NSArray class]]) {
    reject(@"json", @"JSON has no \"marks\" array.", nil);
    return;
  }
  resolve(dict);
}

static void CreateMergedAudiobookResolved(NSString *rootDir,
                                         NSArray *marks,
                                         RCTCallableJSModules *_Nullable jsModulesForProgress,
                                         RCTPromiseResolveBlock resolve,
                                         RCTPromiseRejectBlock reject)
{
  NSFileManager *fm = [NSFileManager defaultManager];
  BOOL isDir = NO;
  NSString *stdRoot = [rootDir stringByStandardizingPath];
  if (![fm fileExistsAtPath:stdRoot isDirectory:&isDir]) {
    reject(@"enoent", @"The project directory does not exist.", nil);
    return;
  }
  if (!isDir) {
    reject(@"notdir", @"The path is not a directory.", nil);
    return;
  }

  NSString *ffmpeg = FfmpegExecutablePath();
  if (ffmpeg == nil || ffmpeg.length == 0) {
    reject(@"no_ffmpeg", @"ffmpeg not found (PATH / Homebrew).", nil);
    return;
  }

  NSError *jerr = nil;
  NSDictionary *payload = @{@"marks" : (marks == nil ? @[] : marks)};
  NSData *jsonData = [NSJSONSerialization dataWithJSONObject:payload options:0 error:&jerr];
  if (jsonData == nil || jerr != nil) {
    reject(@"json", @"Could not serialize chapter data.", jerr);
    return;
  }

  NSString *tmpJson =
      [NSTemporaryDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"audiobook_marks_%u.json", arc4random()]];
  if (![jsonData writeToFile:tmpJson atomically:YES]) {
    reject(@"io", @"Could not write temporary JSON file.", nil);
    return;
  }

  NSString *venv = AppVenvRoot();
  NSString *py = VenvPythonTokenOrReject(fm, venv, reject);
  if (!py) {
    [fm removeItemAtPath:tmpJson error:nil];
    return;
  }

  NSString *mergeScript =
      [[AppProjectRoot() stringByAppendingPathComponent:@"scripts"] stringByAppendingPathComponent:@"merge_mp3_chapters.py"];
  if (![fm isReadableFileAtPath:mergeScript]) {
    [fm removeItemAtPath:tmpJson error:nil];
    reject(@"no_script", @"scripts/merge_mp3_chapters.py not found in the project.", nil);
    return;
  }

  NSString *outPath = [stdRoot stringByAppendingPathComponent:@"AudiobookConverter_merged.m4a"];

  NSString *cmd = [NSString stringWithFormat:
                              @"env PYTHONUNBUFFERED=1 %@ %@ --root-dir %@ --marks-json %@ --ffmpeg %@ --output %@",
                              py,
                              ShellQuotePath(mergeScript),
                              ShellQuotePath(stdRoot),
                              ShellQuotePath(tmpJson),
                              ShellQuotePath(ffmpeg),
                              ShellQuotePath(outPath)];

  int status = -1;
  NSMutableString *stderrAll = [NSMutableString string];
  NSString *stdoutStr =
      RunShellSeparatingStdoutStreamingStderr(cmd, stderrAll, &status, jsModulesForProgress, @"merge");
  NSString *stderrTxt = [stderrAll copy];
  [fm removeItemAtPath:tmpJson error:nil];

  if (stdoutStr == nil) {
    reject(@"run_failed", @"Merge could not be started (shell error).", nil);
    return;
  }
  if (status != 0) {
    NSMutableString *detail = [NSMutableString string];
    if (stderrTxt.length > 0) {
      [detail appendString:stderrTxt];
    }
    if (detail.length == 0 && stdoutStr.length > 0) {
      [detail appendString:stdoutStr];
    }
    if (detail.length == 0) {
      [detail appendString:@"(no output)"];
    }
    if (detail.length > 2000) {
      [detail deleteCharactersInRange:NSMakeRange(2000, detail.length - 2000)];
      [detail appendString:@"…"];
    }
    reject(@"merge_failed", [NSString stringWithFormat:@"ffmpeg / merge failed:\n%@", detail], nil);
    return;
  }

  if (![fm isReadableFileAtPath:outPath]) {
    reject(@"io", @"Output file was not created.", nil);
    return;
  }
  resolve(outPath);
}

static NSString *_Nullable AUBKMetadataString(NSDictionary *_Nullable d, NSString *key)
{
  if (![d isKindOfClass:[NSDictionary class]]) {
    return nil;
  }
  id v = d[key];
  if (![v isKindOfClass:[NSString class]]) {
    return nil;
  }
  NSString *s =
      [(NSString *)v stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  return s.length > 0 ? s : nil;
}

static NSString *_Nullable AUBKDownloadCoverToTempFile(NSString *urlString, NSError **_Nullable outError)
{
  if (urlString.length == 0) {
    return nil;
  }
  NSURL *url = [NSURL URLWithString:urlString];
  if (url == nil) {
    if (outError != NULL) {
      *outError = [NSError errorWithDomain:@"AudioBookConverter"
                                        code:10
                                    userInfo:@{NSLocalizedDescriptionKey : @"Invalid cover URL"}];
    }
    return nil;
  }
  dispatch_semaphore_t sem = dispatch_semaphore_create(0);
  __block NSData *gotData = nil;
  __block NSError *gotErr = nil;
  NSURLSessionDataTask *task = [[NSURLSession sharedSession]
      dataTaskWithURL:url
      completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        if (error != nil) {
          gotErr = error;
        } else if (![response isKindOfClass:[NSHTTPURLResponse class]] ||
                   ((NSHTTPURLResponse *)response).statusCode / 100 != 2) {
          gotErr = [NSError errorWithDomain:@"AudioBookConverter"
                                         code:11
                                     userInfo:@{NSLocalizedDescriptionKey : @"Cover download: HTTP error"}];
        } else {
          gotData = data;
        }
        dispatch_semaphore_signal(sem);
      }];
  [task resume];
  dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);
  if (gotErr != nil) {
    if (outError != NULL) {
      *outError = gotErr;
    }
    return nil;
  }
  if (gotData.length == 0) {
    return nil;
  }
  NSString *path =
      [[NSTemporaryDirectory() stringByAppendingPathComponent:[[NSUUID UUID] UUIDString]]
          stringByAppendingPathExtension:@"jpg"];
  NSError *wErr = nil;
  if (![gotData writeToFile:path options:NSDataWritingAtomic error:&wErr]) {
    if (outError != NULL) {
      *outError = wErr;
    }
    return nil;
  }
  return path;
}

/// metadata: optional keys title, author, coverUrl (HTTPS; downloaded to temp JPEG).
static void FinalizeM4bAudiobookResolved(NSString *mergedM4aPath,
                                      NSString *mp3RootDirectory,
                                      NSDictionary *_Nullable metadata,
                                      RCTPromiseResolveBlock resolve,
                                      RCTPromiseRejectBlock reject)
{
  NSFileManager *fm = [NSFileManager defaultManager];
  NSString *stdRoot = [mp3RootDirectory stringByStandardizingPath];
  NSString *stdMerged = [mergedM4aPath stringByStandardizingPath];

  BOOL isDir = NO;
  if (![fm fileExistsAtPath:stdMerged isDirectory:&isDir]) {
    reject(@"enoent", @"Merged M4A was not found.", nil);
    return;
  }
  if (isDir) {
    reject(@"notfile", @"The path is a directory, not an M4A file.", nil);
    return;
  }

  NSString *mergedParent = [stdMerged stringByDeletingLastPathComponent];
  if (![mergedParent isEqualToString:stdRoot]) {
    reject(
        @"path",
        @"The M4A must sit directly in the selected MP3 folder (MP3 project folder).",
        nil);
    return;
  }

  NSString *ffmpeg = FfmpegExecutablePath();
  if (ffmpeg == nil || ffmpeg.length == 0) {
    reject(@"no_ffmpeg", @"ffmpeg not found.", nil);
    return;
  }

  NSString *destM4b = AUBKM4bOutputPathForProjectFolder(stdRoot);
  if ([fm fileExistsAtPath:destM4b]) {
    NSError *rmErr = nil;
    if (![fm removeItemAtPath:destM4b error:&rmErr]) {
      reject(@"io", @"Could not overwrite existing M4B.", rmErr);
      return;
    }
  }

  id metaId = metadata;
  if (metaId == nil || metaId == [NSNull null]) {
    metaId = nil;
  }
  NSDictionary *meta = [metaId isKindOfClass:[NSDictionary class]] ? metaId : nil;

  NSString *mdTitle = AUBKMetadataString(meta, @"title");
  NSString *mdAuthor = AUBKMetadataString(meta, @"author");
  NSString *mdCoverUrl = AUBKMetadataString(meta, @"coverUrl");

  NSMutableString *metaFlags = [NSMutableString string];
  [metaFlags appendFormat:@" -metadata genre=%@", ShellQuotePath(@"Audiobook")];
  if (mdTitle.length > 0) {
    [metaFlags appendFormat:@" -metadata title=%@", ShellQuotePath(mdTitle)];
    [metaFlags appendFormat:@" -metadata album=%@", ShellQuotePath(mdTitle)];
  }
  if (mdAuthor.length > 0) {
    [metaFlags appendFormat:@" -metadata artist=%@", ShellQuotePath(mdAuthor)];
    [metaFlags appendFormat:@" -metadata album_artist=%@", ShellQuotePath(mdAuthor)];
  }

  NSString *_Nullable coverPath = nil;
  if (mdCoverUrl.length > 0) {
    NSError *dlErr = nil;
    coverPath = AUBKDownloadCoverToTempFile(mdCoverUrl, &dlErr);
    (void)dlErr;
  }
  BOOL useCover = (coverPath != nil && [fm isReadableFileAtPath:coverPath]);

  int status = -1;
  NSString *stderrTxt = nil;

  if (useCover) {
    NSString *cmdCover = [NSString
        stringWithFormat:
            @"%@ -y -hide_banner -loglevel error -i %@ -i %@ -map 0:a -map 1:v -c copy -disposition:v:0 "
            @"attached_pic%@ %@",
            ShellQuotePath(ffmpeg),
            ShellQuotePath(stdMerged),
            ShellQuotePath(coverPath),
            metaFlags,
            ShellQuotePath(destM4b)];
    (void)RunShellSeparatingStdout(cmdCover, &stderrTxt, &status);
  }

  if (status != 0) {
    NSString *cmdPlain = [NSString stringWithFormat:
                                     @"%@ -y -hide_banner -loglevel error -i %@ -c copy%@ %@",
                                     ShellQuotePath(ffmpeg),
                                     ShellQuotePath(stdMerged),
                                     metaFlags,
                                     ShellQuotePath(destM4b)];
    NSString *stderr2 = nil;
    (void)RunShellSeparatingStdout(cmdPlain, &stderr2, &status);
    stderrTxt = stderr2;
  }

  if (coverPath.length > 0) {
    [fm removeItemAtPath:coverPath error:nil];
  }

  if (status != 0) {
    NSString *detail = stderrTxt.length > 0 ? stderrTxt : @"(ffmpeg)";
    if (detail.length > 2000) {
      detail = [[detail substringToIndex:2000] stringByAppendingString:@"…"];
    }
    reject(@"m4b_failed", [NSString stringWithFormat:@"M4B creation failed:\n%@", detail], nil);
    return;
  }

  if (![fm isReadableFileAtPath:destM4b]) {
    reject(@"io", @"M4B was not created.", nil);
    return;
  }

  NSError *delErr = nil;
  if (![fm removeItemAtPath:stdMerged error:&delErr]) {
    reject(@"io",
           [NSString stringWithFormat:@"M4B was created but the source M4A could not be deleted: %@",
                                      delErr.localizedDescription],
           delErr);
    return;
  }

  resolve(destM4b);
}

@implementation DependencyStatus

RCT_EXPORT_MODULE();

@synthesize callableJSModules = _callableJSModules;

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

RCT_REMAP_METHOD(countMp3FilesInDirectory,
                 countMp3FilesInDirectory:(NSString *)dirPath
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  if (dirPath.length == 0) {
    reject(@"empty", @"No directory specified.", nil);
    return;
  }
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    CountMp3FilesInDirectoryResolved(dirPath, resolve, reject);
  });
}

RCT_REMAP_METHOD(detectChaptersWithWhisper,
                 detectChaptersWithWhisper:(NSString *)rootDirectory
                 modelSize:(NSString *)modelSize
                 device:(NSString *)device
                 computeType:(NSString *)computeType
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  if (rootDirectory.length == 0 || modelSize.length == 0 || device.length == 0 ||
      computeType.length == 0) {
    reject(@"empty", @"rootDirectory, modelSize, device, and computeType are required.", nil);
    return;
  }
  RCTCallableJSModules *progressJS = self.callableJSModules;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    DetectChaptersWithWhisperResolved(
        rootDirectory, modelSize, device, computeType, progressJS, resolve, reject);
  });
}

RCT_REMAP_METHOD(createMergedAudiobookWithChapters,
                 createMergedAudiobookWithChapters:(NSString *)rootDirectory
                 marks:(NSArray *)marks
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  if (rootDirectory.length == 0) {
    reject(@"empty", @"rootDirectory is required.", nil);
    return;
  }
  RCTCallableJSModules *progressJS = self.callableJSModules;
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    CreateMergedAudiobookResolved(rootDirectory, marks, progressJS, resolve, reject);
  });
}

RCT_REMAP_METHOD(createM4bAudiobook,
                 createM4bAudiobook:(NSString *)mergedM4aPath
                 mp3RootDirectory:(NSString *)mp3RootDirectory
                 metadata:(NSDictionary *_Nullable)metadata
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  if (mergedM4aPath.length == 0 || mp3RootDirectory.length == 0) {
    reject(@"empty", @"mergedM4aPath and mp3RootDirectory are required.", nil);
    return;
  }
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    FinalizeM4bAudiobookResolved(mergedM4aPath, mp3RootDirectory, metadata, resolve, reject);
  });
}

RCT_REMAP_METHOD(selectDirectory,
                 selectDirectoryWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    panel.canChooseFiles = NO;
    panel.canChooseDirectories = YES;
    panel.allowsMultipleSelection = NO;
    panel.canCreateDirectories = YES;
    panel.prompt = @"Choose";

    NSModalResponse response = [panel runModal];
    if (response == NSModalResponseOK) {
      NSURL *url = panel.URL;
      NSString *path = url.path;
      if (path.length > 0) {
        resolve(path);
        return;
      }
      resolve([NSNull null]);
      return;
    }
    if (response == NSModalResponseCancel) {
      resolve([NSNull null]);
      return;
    }
    reject(@"open_panel_failed", @"Folder selection failed.", nil);
  });
}

RCT_REMAP_METHOD(checkAll, checkAllWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSString *py = PythonExecutableToken(AppVenvRoot());
    NSDictionary *result = @{
      @"python" : CheckPython(py),
      @"pip" : CheckPip(py),
      @"ffmpeg" : CheckFfmpeg(),
      @"fasterWhisper" : CheckFasterWhisper(py),
      @"venvRoot" : AppVenvRoot(),
    };
    resolve(result);
  });
}

RCT_REMAP_METHOD(runSingleDependencyAction,
                 runSingleDependencyAction:(NSString *)key
                 action:(NSString *)action
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSMutableString *log = [NSMutableString string];
    RunSingleDependency(key, action, log, resolve, reject);
  });
}

@end
