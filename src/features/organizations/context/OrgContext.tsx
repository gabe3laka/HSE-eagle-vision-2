import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useMyMemberships, useAllOrganizations } from "../hooks/useOrganizations";
import type { OrganizationRow, OrganizationMemberRow } from "@/integrations/supabase/db";
import { useAuth } from "@/contexts/AuthContext";

const ORG_STORAGE_KEY = "hse_selected_org_id";

interface OrgContextType {
  selectedOrgId: string | null;
  setSelectedOrgId: (id: string | null) => void;
  selectedOrg: OrganizationRow | null;
  myMembership: OrganizationMemberRow | null;
}

const OrgContext = createContext<OrgContextType>({
  selectedOrgId: null,
  setSelectedOrgId: () => {},
  selectedOrg: null,
  myMembership: null,
});

export const useOrg = () => useContext(OrgContext);

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { data: memberships } = useMyMemberships();
  const { data: organizations } = useAllOrganizations();

  const [selectedOrgId, setSelectedOrgIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ORG_STORAGE_KEY);
    } catch {
      return null;
    }
  });

  const setSelectedOrgId = useCallback((id: string | null) => {
    setSelectedOrgIdState(id);
    try {
      if (id) localStorage.setItem(ORG_STORAGE_KEY, id);
      else localStorage.removeItem(ORG_STORAGE_KEY);
    } catch (_e) {
      /* ignore localStorage errors */
    }
  }, []);

  // Auto-select when the user has exactly one active membership
  useEffect(() => {
    if (!user || !memberships || memberships.length === 0) return;
    if (selectedOrgId) return;
    if (memberships.length === 1) setSelectedOrgId(memberships[0].org_id);
  }, [memberships, selectedOrgId, setSelectedOrgId, user]);

  // Clear selection if user lost membership
  useEffect(() => {
    if (!memberships || !selectedOrgId) return;
    const still = memberships.some((m) => m.org_id === selectedOrgId);
    if (!still) setSelectedOrgId(null);
  }, [memberships, selectedOrgId, setSelectedOrgId]);

  const selectedOrg = useMemo(
    () => organizations?.find((o) => o.id === selectedOrgId) ?? null,
    [organizations, selectedOrgId],
  );

  const myMembership = useMemo(
    () => memberships?.find((m) => m.org_id === selectedOrgId) ?? null,
    [memberships, selectedOrgId],
  );

  return (
    <OrgContext.Provider value={{ selectedOrgId, setSelectedOrgId, selectedOrg, myMembership }}>
      {children}
    </OrgContext.Provider>
  );
}
