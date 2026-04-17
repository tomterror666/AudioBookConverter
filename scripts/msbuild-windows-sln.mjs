#!/usr/bin/env node
/**
 * Builds the Windows RNW solution with Visual Studio's MSBuild (VC toolset).
 * `dotnet msbuild` cannot load vcxproj C++ imports (MSB4278: VCTargetsPath / Microsoft.Cpp.Default.props).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function vswherePath() {
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  return join(pf86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
}

function findMsBuildWithVsWhere() {
  const vswhere = vswherePath();
  if (!existsSync(vswhere)) {
    return null;
  }
  const vcReq = ['-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64'];
  const find = ['-find', 'MSBuild\\Current\\Bin\\MSBuild.exe'];
  /** Prefer VS 2022 (17.x): WASDK in-process XAML on MSBuild 18 can throw WMC9999; Core-only UseXamlCompilerExecutable is blocked on Full MSBuild. */
  const argsSets = [
    ['-latest', '-version', '[17.0,18.0)', '-products', '*', ...vcReq, ...find],
    ['-latest', '-products', '*', ...vcReq, ...find],
    ['-latest', '-products', '*', ...find],
  ];
  for (const args of argsSets) {
    try {
      const out = execFileSync(vswhere, args, { encoding: 'utf8' }).trim();
      const line = out.split(/\r?\n/).find((l) => l.length > 0);
      if (line && existsSync(line)) {
        return line;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

function warnIfVs18Msbuild(msbuildPath) {
  const norm = msbuildPath.replace(/\\/g, '/').toLowerCase();
  if (norm.includes('/microsoft visual studio/18/')) {
    console.warn(
      '[windows] Using Visual Studio 18 (2026) MSBuild. UWP / WinUI XAML may hit WMC9999 (XamlType vs DirectUIXamlType).\n' +
        '[windows] Install Visual Studio 2022 (17.x) with “Desktop development with C++” side-by-side — this script prefers its MSBuild.\n' +
        '[windows] Or set MSBUILD_EXE to VS2022 MSBuild.exe explicitly.',
    );
  }
}

function resolveMsBuild() {
  const env = process.env.MSBUILD_EXE;
  if (env && existsSync(env)) {
    return env;
  }
  return findMsBuildWithVsWhere();
}

const msbuild = resolveMsBuild();
if (!msbuild) {
  console.error(
    'MSBuild with C++ (VC) workload not found. Install Visual Studio (Desktop development with C++),\n' +
      'or set MSBUILD_EXE to MSBuild.exe under ...\\Microsoft Visual Studio\\...\\MSBuild\\Current\\Bin\\',
  );
  process.exit(1);
}
warnIfVs18Msbuild(msbuild);

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/msbuild-windows-sln.mjs <solution.sln> [msbuild args...]');
  process.exit(1);
}

const r = spawnSync(msbuild, args, { stdio: 'inherit', windowsVerbatimArguments: false });
process.exit(r.status === null ? 1 : r.status);
