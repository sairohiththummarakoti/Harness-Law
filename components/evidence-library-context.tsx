"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Evidence, EvidenceFolder } from "@/lib/model";

export interface EvidenceLibrary {
  documents: Evidence[];
  folders: EvidenceFolder[];
  mode: "personal" | "sample";
  caseId: string;
  accountId: string | null;
  consent: boolean;
  disabled: boolean;
  upload: (file: File, signal?: AbortSignal) => Promise<Evidence>;
  read: (document: Evidence, signal?: AbortSignal) => Promise<File>;
  grantConsent: () => Promise<void>;
}

const EvidenceContext = createContext<EvidenceLibrary | null>(null);
export function EvidenceLibraryProvider({ value, children }: { value: EvidenceLibrary; children: ReactNode }) {
  return <EvidenceContext.Provider value={value}>{children}</EvidenceContext.Provider>;
}
export const useEvidenceLibrary = () => useContext(EvidenceContext);
