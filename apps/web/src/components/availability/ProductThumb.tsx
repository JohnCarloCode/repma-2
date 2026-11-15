/**
 * A product thumb: the image, or a placeholder with the name's initials (seed
 * images are NULL until 8.8). `sizeClass` sets the square (32px on list lines,
 * larger on the detail's summary card).
 */
export function ProductThumb({
  name,
  imageUrl,
  sizeClass = 'size-[32px]',
}: {
  name: string;
  imageUrl: string | null;
  sizeClass?: string;
}) {
  const box = `${sizeClass} flex-none rounded-sm border border-border bg-surface-raised`;
  if (imageUrl) return <img src={imageUrl} alt="" className={`${box} object-cover`} />;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
  return (
    <span aria-hidden className={`${box} inline-flex items-center justify-center text-label text-text-secondary`}>
      {initials}
    </span>
  );
}
