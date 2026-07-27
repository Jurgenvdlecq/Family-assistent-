import { CameraOff } from "lucide-react";

type RecipePhotoRecipe = {
  title: string;
  imageUrl: string | null;
};

export default function RecipePhoto({
  recipe,
  className = "h-14 w-14 rounded-xl",
}: {
  recipe: RecipePhotoRecipe | null | undefined;
  className?: string;
}) {
  const imageUrl = recipe?.imageUrl?.trim();

  if (imageUrl) {
    return (
      <div
        role="img"
        aria-label={recipe?.title ?? "Gerechtfoto"}
        className={`shrink-0 bg-cover bg-center bg-no-repeat ${className}`}
        style={{ backgroundImage: `url(${imageUrl})` }}
      />
    );
  }

  return (
    <div
      className={`flex shrink-0 items-center justify-center border border-line bg-surface-2 text-ink-faint ${className}`}
      aria-label={recipe?.title ? `Nog geen echte foto gekoppeld voor ${recipe.title}` : "Nog geen gerechtfoto"}
    >
      <CameraOff size={18} />
    </div>
  );
}
