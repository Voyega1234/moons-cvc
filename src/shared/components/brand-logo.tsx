import { useState } from "react";
import { brandLogoUrl, type Brand } from "../../domain/brand";

export function BrandLogo({
  brand,
  assetUrl,
  alt = ""
}: {
  brand: Brand;
  assetUrl?: string;
  alt?: string;
}) {
  const logoUrl = assetUrl ?? brandLogoUrl(brand);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!logoUrl || logoUrl === failedUrl) return <>{brand.initials}</>;

  return (
    <img
      src={logoUrl}
      alt={alt}
      onError={() => setFailedUrl(logoUrl)}
    />
  );
}
