/** The café's logo (round, red on white). */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <img
      src="/logo-128.png"
      width={size}
      height={size}
      alt=""
      aria-hidden
      className="shrink-0 rounded-full bg-white object-contain"
      style={{ width: size, height: size }}
    />
  );
}
