import { AlertCircle, Truck } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getPreferredDeliverySlotStatusForHousehold } from "@/lib/picnic/deliveryStatus";
import { DAY_KEY_BY_ENUM, DAY_LABELS } from "@/lib/week";

const STATUS_TONE: Record<string, string> = {
  AVAILABLE: "border-tag-green-ink/25 bg-tag-green-bg text-tag-green-ink",
  EXACT_TIME_UNAVAILABLE: "border-tag-amber-ink/25 bg-tag-amber-bg text-tag-amber-ink",
  NO_NEARBY_SLOTS: "border-tag-amber-ink/25 bg-tag-amber-bg text-tag-amber-ink",
  NO_SLOTS_FOR_DAY: "border-tag-amber-ink/25 bg-tag-amber-bg text-tag-amber-ink",
  UNKNOWN: "border-line bg-surface-2 text-ink-muted",
};

export default async function PicnicDeliveryStatusCard({
  householdId,
  picnicAuthToken,
}: {
  householdId: string;
  picnicAuthToken: string | null;
}) {
  const preference = await prisma.picnicDeliveryPreference.findUnique({ where: { householdId } });
  if (!preference) return null;

  const dayLabel = DAY_LABELS[DAY_KEY_BY_ENUM[preference.preferredDayOfWeek]];

  if (!picnicAuthToken) {
    return (
      <div className="mb-4 min-w-0 rounded-xl border border-line bg-surface-2 p-3 text-xs text-ink-muted">
        <p className="flex items-center gap-2 font-medium text-ink">
          <Truck size={16} />
          Gewenst bezorgmoment: {dayLabel.toLowerCase()} rond {preference.preferredTime}
        </p>
        <p className="mt-1">Koppel je Picnic-account om de actuele status te zien.</p>
      </div>
    );
  }

  const status = await getPreferredDeliverySlotStatusForHousehold({
    householdId,
    picnicAuthToken,
    preferredDay: preference.preferredDayOfWeek,
    preferredTime: preference.preferredTime,
    windowMinutes: preference.windowMinutes,
  });

  return (
    <div className={`mb-4 min-w-0 rounded-xl border p-3 text-xs ${STATUS_TONE[status.status]}`}>
      <p className="flex items-center gap-2 font-medium">
        {status.status === "UNKNOWN" ? <AlertCircle size={16} /> : <Truck size={16} />}
        Gewenst bezorgmoment: {dayLabel.toLowerCase()} rond {preference.preferredTime}
      </p>
      <p className="mt-1">{status.message}</p>
    </div>
  );
}
