"use client";

import { useFormStatus } from "react-dom";

export default function PendingSubmitButton({
  children,
  pendingText = "Bezig...",
  className,
  disabled = false,
  title,
  ariaLabel,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className: string;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      title={title}
      aria-label={ariaLabel}
      aria-busy={pending}
      className={`${className} transition-all duration-150 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:active:scale-100`}
    >
      {pending ? pendingText : children}
    </button>
  );
}
