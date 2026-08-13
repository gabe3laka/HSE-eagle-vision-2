import { Link } from "@/lib/router-shim";
import { Button } from "@/components/ui/button";
import { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  actionHref?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  actionHref,
}: EmptyStateProps) {
  return (
    <div className="console-panel flex flex-col items-center justify-center px-6 py-16 text-center animate-fade-in-up">
      <div className="glyph-halo mb-8 h-14 w-14">
        <Icon className="h-6 w-6" aria-hidden />
      </div>
      <h3 className="font-display text-lg font-semibold mb-1.5">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">{description}</p>
      {actionLabel &&
        (actionHref ? (
          <Button asChild className="btn-sheen pressable">
            <Link to={actionHref}>{actionLabel}</Link>
          </Button>
        ) : onAction ? (
          <Button onClick={onAction} className="btn-sheen pressable">
            {actionLabel}
          </Button>
        ) : null)}
    </div>
  );
}
