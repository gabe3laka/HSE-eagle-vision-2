// Shim providing react-router-dom-compatible exports backed by TanStack Router.
import {
  Link as TSLink,
  Navigate as TSNavigate,
  useLocation as tsUseLocation,
  useNavigate as tsUseNavigate,
  type LinkProps as TSLinkProps,
} from "@tanstack/react-router";
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";

type AnyTo = string | { to: string; replace?: boolean };

export const Link = forwardRef<HTMLAnchorElement, { to: string; replace?: boolean; children?: ReactNode } & Omit<ComponentPropsWithoutRef<"a">, "href">>(
  ({ to, replace, children, ...rest }, ref) => (
    // @ts-expect-error TanStack typed routes are stricter than RR's plain strings
    <TSLink ref={ref} to={to} replace={replace} {...(rest as TSLinkProps)}>
      {children}
    </TSLink>
  ),
);
Link.displayName = "Link";

export function Navigate({ to, replace }: { to: string; replace?: boolean }) {
  // @ts-expect-error see above
  return <TSNavigate to={to} replace={replace} />;
}

export function useLocation() {
  const loc = tsUseLocation();
  return { pathname: loc.pathname, search: loc.search, hash: loc.hash };
}

export function useNavigate() {
  const nav = tsUseNavigate();
  return (to: AnyTo, opts?: { replace?: boolean }) => {
    if (typeof to === "string") {
      // @ts-expect-error string path is fine at runtime
      nav({ to, replace: opts?.replace });
    } else {
      // @ts-expect-error
      nav(to);
    }
  };
}

// Re-export for any rare callers
export type { TSLinkProps as LinkProps };
