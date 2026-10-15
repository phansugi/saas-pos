import { createContext, useContext } from "react";
import type { StoreApi } from "./types";

export const StoreContext = createContext<StoreApi | null>(null);

export function useStore(): StoreApi {
  const ctx = useContext(StoreContext);
  if (!ctx) {
    throw new Error("useStore harus dipakai di dalam <StoreProvider>.");
  }
  return ctx;
}
