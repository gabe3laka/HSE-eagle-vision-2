import {
  Link as TSLink,
  Navigate as TSNavigate,
  useLocation as tsUseLocation,
  useNavigate as tsUseNavigate,
} from "@tanstack/react-router";
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";

type AnyLink = typeof TSLink;

export const Link = forwardRef<
  HTMLAnchorElement,
  { to: string; replace?: boolean; children?: ReactNode } & Omit<
    ComponentPropsWithoutRef<"a">,
    "href"
  >
>(({ to, replace, children, ...rest }, ref) => {
  // @ts-ignore - TanStack Link accepts plain strings at runtime
  return (
    <TSLink ref={ref} to={to} replace={replace} {...rest}>
      {children}
    </TSLink>
  );
});
Link.displayName = "Link";

export interface NavLinkProps
  extends Omit<ComponentPropsWithoutRef<"a">, "href" | "className"> {
  to: string;
  replace?: boolean;
  end?: boolean;
  className?:
    | string
    | ((state: { isActive: boolean; isPending: boolean }) => string);
  children?:
    | ReactNode
    | ((state: { isActive: boolean; isPending: boolean }) => ReactNode);
}

export const NavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(
  ({ to, replace, end, className, children, ...rest }, ref) => {
    const loc = tsUseLocation();
    const isActive = end ? loc.pathname === to : loc.pathname.startsWith(to);
    const state = { isActive, isPending: false };
    const resolvedClassName =
      typeof className === "function" ? className(state) : className;
    const resolvedChildren =
      typeof children === "function" ? children(state) : children;
    // @ts-ignore - TanStack Link accepts plain strings at runtime
    return (
      <TSLink
        ref={ref}
        to={to}
        replace={replace}
        className={resolvedClassName}
        {...rest}
      >
        {resolvedChildren}
      </TSLink>
    );
  },
);
NavLink.displayName = "NavLink";

export function Navigate({ to, replace }: { to: string; replace?: boolean }) {
  // @ts-ignore
  return <TSNavigate to={to} replace={replace} />;
}

export function useLocation() {
  const loc = tsUseLocation();
  return { pathname: loc.pathname, search: loc.search, hash: loc.hash };
}

export function useNavigate() {
  const nav = tsUseNavigate();
  return (
    to: string | { to: string; replace?: boolean },
    opts?: { replace?: boolean },
  ) => {
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
