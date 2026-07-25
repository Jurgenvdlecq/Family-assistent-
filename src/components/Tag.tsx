import type { TagTone } from "@/lib/categoryStyle";

const TONE_CLASSES: Record<TagTone, string> = {
  blue: "bg-tag-blue-bg text-tag-blue-ink",
  green: "bg-tag-green-bg text-tag-green-ink",
  amber: "bg-tag-amber-bg text-tag-amber-ink",
  purple: "bg-tag-purple-bg text-tag-purple-ink",
  pink: "bg-tag-pink-bg text-tag-pink-ink",
};

export default function Tag({ tone, children }: { tone: TagTone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}
