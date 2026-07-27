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
      className={`${className} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {pending ? pendingText : children}
    </button>
  );
}
