import React, { createContext, useContext, useMemo } from "react";
import { getUiCopy, type UiCopy, type UiLocale } from "./uiCopy";

const UiLocaleContext = createContext<UiLocale | null>(null);

/**
 * Binds UI strings to the chapter language (de/en). Wrap content that should react to the switch.
 */
export function UiLocaleProvider(props: {
  value: UiLocale;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <UiLocaleContext.Provider value={props.value}>
      {props.children}
    </UiLocaleContext.Provider>
  );
}

/** Chapter-cue / UI copy for the current locale. Falls back to German outside a provider. */
export function useUiCopy(): UiCopy {
  const locale = useContext(UiLocaleContext);
  return useMemo(
    () => getUiCopy(locale ?? "de"),
    [locale],
  );
}
