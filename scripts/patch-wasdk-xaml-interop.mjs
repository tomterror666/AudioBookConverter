/**
 * WMC9999: in-process CompileXaml fails (XamlType vs DirectUIXamlType). WASDK can use the
 * out-of-process XAML compiler when UseXamlCompilerExecutable=true, but interop.targets
 * emits Error when MSBuildRuntimeType != Core. Remove those Error elements in the NuGet
 * cache copy so Full MSBuild (VS 2022) can use the executable path.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKER = '<!-- AudioBookConverter: wasdk-interop-patched (WMC9999) -->';

/**
 * WASDK 1.7+ splits this `<Error>` across two lines (Text on one line, Condition on the next).
 * A single-line-only regex misses those; `[\s\S]*?` matches CRLF/LF between attributes.
 */
const ERROR_BLOCK =
  /<Error\s+Text="The executable Xaml compiler is no longer supported\.\s+Please set UseXamlCompilerExecutable=false\."[\s\S]*?Condition=" '\$\(MSBuildRuntimeType\)' != 'Core' And '\$\(UseXamlCompilerExecutable\)' == 'true'" \/>/g;

const LEGACY_ERROR_BLOCK =
  /<Error\s+Text="The executable Xaml compiler is no longer supported\.\s+Please set UseXamlCompilerExecutable=false\."\s+Condition=" '\$\(MSBuildRuntimeType\)' != 'Core' And '\$\(UseXamlCompilerExecutable\)' == 'true'" \/>/g;

function readWasdkVersion(repoRoot) {
  const vcx = path.join(repoRoot, 'windows', 'AudioBookConverter', 'AudioBookConverter.vcxproj');
  if (!fs.existsSync(vcx)) return null;
  const xml = fs.readFileSync(vcx, 'utf8');
  const m = xml.match(/PackageReference Include="Microsoft\.WindowsAppSDK" Version="([^"]+)"/);
  return m ? m[1] : null;
}

/**
 * @param {string} repoRoot
 */
export function applyWasdkXamlInteropPatch(repoRoot) {
  if (process.platform !== 'win32') {
    return;
  }
  const home = process.env.USERPROFILE;
  if (!home) {
    return;
  }
  const ver = readWasdkVersion(repoRoot);
  if (!ver) {
    return;
  }
  const base = path.join(home, '.nuget', 'packages', 'microsoft.windowsappsdk', ver.toLowerCase());
  const relPaths = [
    path.join('buildTransitive', 'Microsoft.UI.Xaml.Markup.Compiler.interop.targets'),
    path.join('build', 'Microsoft.UI.Xaml.Markup.Compiler.interop.targets'),
  ];
  const files = relPaths.map((r) => path.join(base, r)).filter((p) => fs.existsSync(p));
  if (files.length === 0) {
    console.warn(
      `[patch-wasdk-xaml-interop] WASDK ${ver} not in NuGet cache yet; patch will apply after packages are restored.`,
    );
    return;
  }

  for (const interop of files) {
    let content = fs.readFileSync(interop, 'utf8');
    if (content.includes(MARKER)) {
      continue;
    }
    const before = content;
    content = content.replace(ERROR_BLOCK, '');
    content = content.replace(LEGACY_ERROR_BLOCK, '');
    const removed = before.length - content.length;
    if (removed === 0) {
      const stillBlocked =
        /executable Xaml compiler is no longer supported/i.test(before) &&
        /MSBuildRuntimeType.*UseXamlCompilerExecutable/i.test(before);
      if (stillBlocked) {
        console.warn(
          `[patch-wasdk-xaml-interop] Blocking "executable Xaml compiler" Error is still present but the removal pattern did not match. Update ERROR_BLOCK in scripts/patch-wasdk-xaml-interop.mjs.\n  ${interop}`,
        );
      }
      continue;
    }
    if (!content.includes(MARKER)) {
      content = content.replace(/^(<\?xml[^?]*\?>\s*)/m, `$1${MARKER}\n`);
    }
    fs.writeFileSync(interop, content, 'utf8');
    console.warn(`[patch-wasdk-xaml-interop] Patched ${interop}`);
  }
}

const __filename = fileURLToPath(import.meta.url);
const invoked = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (invoked) {
  applyWasdkXamlInteropPatch(process.cwd());
}
