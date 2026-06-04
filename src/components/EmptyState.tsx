import { Link } from "react-router-dom";
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

export function EmptyState({ icon: Icon, title, description, actionLabel, onAction, actionHref }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center animate-fade-in-up glass-subtle rounded-xl">
      <div className="relative rounded-2xl bg-primary/10 p-5 mb-5">
        <div className="absolute inset-0 rounded-2xl bg-[radial-gradient(ellipse,rgba(16,185,129,0.15),transparent_70%)]" />
        <Icon className="h-10 w-10 text-muted-foreground/40 relative z-10" />
      </div>
      <h3 className="font-display text-lg font-semibold mb-1.5">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">{description}</p>
      {actionLabel && (actionHref ? (
        <Button asChild>
          <Link to={actionHref}>{actionLabel}</Link>
        </Button>
      ) : onAction ? (
        <Button onClick={onAction}>{actionLabel}</Button>
      ) : null)}
    </div>
  );
}
