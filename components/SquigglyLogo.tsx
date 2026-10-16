import Image from 'next/image';

// Trimmed wordmark in /public is 1200x166.
const LOGO_WIDTH = 1200;
const LOGO_HEIGHT = 166;

interface SquigglyLogoProps {
  /** Rendered height in px; width follows the logo's aspect ratio. */
  height?: number;
  className?: string;
  priority?: boolean;
}

export default function SquigglyLogo({ height = 28, className, priority = true }: SquigglyLogoProps) {
  return (
    <Image
      src="/squiggly-logo.png"
      alt="Squiggly"
      width={Math.round((height * LOGO_WIDTH) / LOGO_HEIGHT)}
      height={height}
      priority={priority}
      className={className}
    />
  );
}
