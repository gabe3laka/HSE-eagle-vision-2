import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      duration={4000}
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-[var(--shadow-overlay)] group-[.toaster]:rounded-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          error: "group-[.toaster]:!border-critical/40 group-[.toaster]:!text-foreground",
          success: "group-[.toaster]:!border-ok/40 group-[.toaster]:!text-foreground",
          warning: "group-[.toaster]:!border-warning/40 group-[.toaster]:!text-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
