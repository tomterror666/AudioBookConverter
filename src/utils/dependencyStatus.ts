import { NativeModules, Platform } from "react-native";

export type DependencyLedStatus = "missing" | "wrong_version" | "ok";

export type DependencyStatuses = {
  python: DependencyLedStatus;
  pip: DependencyLedStatus;
  ffmpeg: DependencyLedStatus;
  fasterWhisper: DependencyLedStatus;
};

export type DependencyKey = keyof DependencyStatuses;

export function allDependencyLedsGreen(
  statuses: DependencyStatuses | null,
): boolean {
  if (!statuses) {
    return false;
  }
  return (
    statuses.python === "ok" &&
    statuses.pip === "ok" &&
    statuses.ffmpeg === "ok" &&
    statuses.fasterWhisper === "ok"
  );
}

export type DependencyCheckResult = {
  statuses: DependencyStatuses;
  /**
   * Python info row: venv path for display (standard location shown as `~/.audioBookConverter`).
   */
  venvPathDisplay: string | null;
};

const VENV_DISPLAY = "~/.audioBookConverter";
const VENV_LEAF = "/.audioBookConverter";

/**
 * Python info display. Native venv is always ~/.audioBookConverter; show that form for matching paths.
 */
function venvPathForPythonInfoDisplay(venvRoot: string | null): string {
  if (!venvRoot) {
    return VENV_DISPLAY;
  }
  const normalized = venvRoot.replace(/\/+$/, "");
  if (
    normalized.endsWith(VENV_LEAF) ||
    normalized === ".audioBookConverter" ||
    /[/\\]\.audioBookConverter$/i.test(normalized)
  ) {
    return VENV_DISPLAY;
  }
  return venvRoot;
}

const DEFAULT_MISSING: DependencyStatuses = {
  python: "missing",
  pip: "missing",
  ffmpeg: "missing",
  fasterWhisper: "missing",
};

function normalizeStatus(v: unknown): DependencyLedStatus {
  if (v === "ok" || v === "wrong_version" || v === "missing") {
    return v;
  }
  return "missing";
}

/** Python venv lives at ~/.audioBookConverter (macOS native, user home). */
export async function runDependencyChecks(): Promise<DependencyCheckResult> {
  if (Platform.OS !== "macos") {
    return { statuses: DEFAULT_MISSING, venvPathDisplay: null };
  }
  const mod = NativeModules.DependencyStatus as
    | { checkAll: () => Promise<Record<string, string>> }
    | undefined;
  if (!mod?.checkAll) {
    return {
      statuses: DEFAULT_MISSING,
      venvPathDisplay: venvPathForPythonInfoDisplay(null),
    };
  }
  try {
    const raw = await mod.checkAll();
    const rawAny = raw as Record<string, unknown>;
    const vr =
      typeof raw.venvRoot === "string"
        ? raw.venvRoot
        : typeof rawAny.venv_root === "string"
        ? rawAny.venv_root
        : null;
    const venvRoot = vr;
    return {
      statuses: {
        python: normalizeStatus(raw.python),
        pip: normalizeStatus(raw.pip),
        ffmpeg: normalizeStatus(raw.ffmpeg),
        fasterWhisper: normalizeStatus(raw.fasterWhisper),
      },
      venvPathDisplay: venvPathForPythonInfoDisplay(venvRoot),
    };
  } catch {
    return {
      statuses: DEFAULT_MISSING,
      venvPathDisplay: venvPathForPythonInfoDisplay(null),
    };
  }
}

/** Install or update a single dependency. */
export async function runSingleDependencyAction(
  key: DependencyKey,
  mode: "install" | "update",
): Promise<string> {
  if (Platform.OS !== "macos") {
    throw new Error("Only available on macOS.");
  }
  const mod = NativeModules.DependencyStatus as
    | {
        runSingleDependencyAction: (
          k: string,
          m: string,
        ) => Promise<{ log?: string }>;
      }
    | undefined;
  if (!mod?.runSingleDependencyAction) {
    throw new Error("Action not available.");
  }
  const r = await mod.runSingleDependencyAction(key, mode);
  return typeof r?.log === "string" ? r.log : "";
}
