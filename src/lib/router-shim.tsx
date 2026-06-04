import {
  Link as TSLink,
  Navigate as TSNavigate,
  useLocation as tsUseLocation,
  useNavigate as tsUseNavigate,
} from "@tanstack/react-router";
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";

type AnyLink = typeof TSLink;

export const Link = forwardRef<HTMLAnchorElement, { to: string; replace?: boolean; children?: ReactNode } & Omit<ComponentPropsWithoutRef<"a">, "href">>(
  ({ to, replace, children, ...rest }, ref) => {
    // @ts-ignore - TanStack Link accepts plain strings at runtime
    return <TSLink ref={ref} to={to} replace={replace} {...rest}>{children}</TSLink>;
  },
);
Link.displayName = "Link";

export function Navigate({ to, replace }: { to: string; replace?: boolean }) {
  // @ts-ignore - same runtime acceptance
  return <TSNavigate to={to} replace={replace} />;
}

export function useLocation() {
  const loc = tsUseLocation();
  return { pathname: loc.pathname, search: loc.search, hash: loc.hash };
}

export function useNavigate() {
  const nav = tsUseNavigate();
  return (to: string | { to: string; replace?: boolean }, opts?: { replace?: boolean }) => {
    if (typeof to === "string") {
      // @ts-ignore
      nav({ to, replace: opts?.replace });
    } else {
      // @ts-ignore
      nav(to);
    }
  };
}

export type _UnusedLink = AnyLink;
