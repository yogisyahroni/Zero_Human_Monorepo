import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Company } from "@paperclipai/shared";
import { companiesApi, type CompanyStats } from "../api/companies";
import { ApiError } from "../api/client";
import { queryKeys } from "../lib/queryKeys";
import type { CompanySelectionSource } from "../lib/company-selection";
type CompanySelectionOptions = { source?: CompanySelectionSource };
type CompanyListResult = { companies: Company[]; unauthorized: boolean };

interface CompanyContextValue {
  companies: Company[];
  selectedCompanyId: string | null;
  selectedCompany: Company | null;
  selectionSource: CompanySelectionSource;
  loading: boolean;
  error: Error | null;
  setSelectedCompanyId: (companyId: string, options?: CompanySelectionOptions) => void;
  reloadCompanies: () => Promise<void>;
  createCompany: (data: {
    name: string;
    description?: string | null;
    budgetMonthlyCents?: number;
  }) => Promise<Company>;
}

const STORAGE_KEY = "paperclip.selectedCompanyId";

const CompanyContext = createContext<CompanyContextValue | null>(null);

type BootstrapCompany = Pick<Company, "id"> & Partial<Pick<Company, "createdAt" | "updatedAt">>;

function timestampValue(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareBootstrapCompanies(a: BootstrapCompany, b: BootstrapCompany, stats?: CompanyStats): number {
  const aStats = stats?.[a.id] ?? { agentCount: 0, issueCount: 0 };
  const bStats = stats?.[b.id] ?? { agentCount: 0, issueCount: 0 };
  const issueDelta = aStats.issueCount - bStats.issueCount;
  if (issueDelta !== 0) return issueDelta;
  const agentDelta = aStats.agentCount - bStats.agentCount;
  if (agentDelta !== 0) return agentDelta;
  const updatedDelta = timestampValue(a.updatedAt) - timestampValue(b.updatedAt);
  if (updatedDelta !== 0) return updatedDelta;
  return timestampValue(a.createdAt) - timestampValue(b.createdAt);
}

function pickBestBootstrapCompany(companies: BootstrapCompany[], stats?: CompanyStats): string | null {
  return companies.reduce<BootstrapCompany | null>((best, company) => {
    if (!best) return company;
    return compareBootstrapCompanies(company, best, stats) > 0 ? company : best;
  }, null)?.id ?? null;
}

export function resolveBootstrapCompanySelection(input: {
  companies: BootstrapCompany[];
  sidebarCompanies: BootstrapCompany[];
  selectedCompanyId: string | null;
  storedCompanyId: string | null;
  stats?: CompanyStats;
}) {
  if (input.companies.length === 0) return null;

  const selectableCompanies = input.sidebarCompanies.length > 0
    ? input.sidebarCompanies
    : input.companies;
  if (input.selectedCompanyId && selectableCompanies.some((company) => company.id === input.selectedCompanyId)) {
    return input.selectedCompanyId;
  }
  if (input.storedCompanyId && selectableCompanies.some((company) => company.id === input.storedCompanyId)) {
    return input.storedCompanyId;
  }
  return pickBestBootstrapCompany(selectableCompanies, input.stats);
}

export function shouldClearStoredCompanySelection(input: {
  companies: Array<Pick<Company, "id">>;
  isLoading: boolean;
  unauthorized: boolean;
}) {
  return !input.isLoading && !input.unauthorized && input.companies.length === 0;
}

export function CompanyProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [selectionSource, setSelectionSource] = useState<CompanySelectionSource>("bootstrap");
  const [selectedCompanyId, setSelectedCompanyIdState] = useState<string | null>(null);

  const { data: companiesResult = { companies: [], unauthorized: false }, isLoading, error } = useQuery<CompanyListResult>({
    queryKey: queryKeys.companies.all,
    queryFn: async () => {
      try {
        return { companies: await companiesApi.list(), unauthorized: false };
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          return { companies: [], unauthorized: true };
        }
        throw err;
      }
    },
    retry: false,
  });
  const companies = companiesResult.companies;
  const companyListUnauthorized = companiesResult.unauthorized;
  const {
    data: companyStats,
    isError: companyStatsError,
    isLoading: companyStatsLoading,
  } = useQuery<CompanyStats>({
    queryKey: queryKeys.companies.stats,
    queryFn: () => companiesApi.stats(),
    retry: false,
    enabled: !companyListUnauthorized,
  });
  const sidebarCompanies = useMemo(
    () => companies.filter((company) => company.status !== "archived"),
    [companies],
  );

  // Auto-select first company when list loads
  useEffect(() => {
    if (isLoading) return;
    if (companies.length === 0) {
      if (shouldClearStoredCompanySelection({ companies, isLoading: false, unauthorized: companyListUnauthorized })) {
        if (selectedCompanyId !== null) {
          setSelectedCompanyIdState(null);
        }
        localStorage.removeItem(STORAGE_KEY);
      }
      return;
    }

    const selectableCompanies = sidebarCompanies.length > 0
      ? sidebarCompanies
      : companies;
    const storedCompanyId = localStorage.getItem(STORAGE_KEY);
    const hasValidSelectedCompany = Boolean(
      selectedCompanyId && selectableCompanies.some((company) => company.id === selectedCompanyId),
    );
    const hasValidStoredCompany = Boolean(
      storedCompanyId && selectableCompanies.some((company) => company.id === storedCompanyId),
    );

    if (
      selectableCompanies.length > 1
      && !hasValidSelectedCompany
      && !hasValidStoredCompany
      && companyStatsLoading
      && !companyStatsError
    ) {
      return;
    }

    const next = resolveBootstrapCompanySelection({
      companies,
      sidebarCompanies,
      selectedCompanyId,
      storedCompanyId,
      stats: companyStats ?? {},
    });
    if (next === null || next === selectedCompanyId) return;
    setSelectedCompanyIdState(next);
    setSelectionSource("bootstrap");
    localStorage.setItem(STORAGE_KEY, next);
  }, [
    companies,
    companyListUnauthorized,
    companyStats,
    companyStatsError,
    companyStatsLoading,
    isLoading,
    selectedCompanyId,
    sidebarCompanies,
  ]);

  const setSelectedCompanyId = useCallback((companyId: string, options?: CompanySelectionOptions) => {
    setSelectedCompanyIdState(companyId);
    setSelectionSource(options?.source ?? "manual");
    localStorage.setItem(STORAGE_KEY, companyId);
  }, []);

  const reloadCompanies = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: (data: {
      name: string;
      description?: string | null;
      budgetMonthlyCents?: number;
    }) =>
      companiesApi.create(data),
    onSuccess: (company) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      setSelectedCompanyId(company.id);
    },
  });

  const createCompany = useCallback(
    async (data: {
      name: string;
      description?: string | null;
      budgetMonthlyCents?: number;
    }) => {
      return createMutation.mutateAsync(data);
    },
    [createMutation],
  );

  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === selectedCompanyId) ?? null,
    [companies, selectedCompanyId],
  );

  const value = useMemo(
    () => ({
      companies,
      selectedCompanyId,
      selectedCompany,
      selectionSource,
      loading: isLoading,
      error: error as Error | null,
      setSelectedCompanyId,
      reloadCompanies,
      createCompany,
    }),
    [
      companies,
      selectedCompanyId,
      selectedCompany,
      selectionSource,
      isLoading,
      error,
      setSelectedCompanyId,
      reloadCompanies,
      createCompany,
    ],
  );

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) {
    throw new Error("useCompany must be used within CompanyProvider");
  }
  return ctx;
}
