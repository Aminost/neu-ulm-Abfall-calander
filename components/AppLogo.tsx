/**
 * AppLogo — the in-app version of the launcher icon.
 *
 * Geometry is shared with scripts/generate_icons.py (1024-unit viewBox) so
 * the logo on the welcome screen matches the icon on the home screen exactly.
 */
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";

const BODY =
  "M320.7 456.2 L320.2 449.4 L320.4 443.3 L321.3 437.7 L322.8 432.7 L325 428.4 L327.8 424.5 L331.2 421.3 L335.4 418.7 L340.2 416.6 L345.6 415.2 L351.7 414.3 L358.4 414 L665.6 414 L672.3 414.3 L678.4 415.2 L683.8 416.6 L688.6 418.7 L692.8 421.3 L696.2 424.5 L699 428.4 L701.2 432.7 L702.7 437.7 L703.6 443.3 L703.8 449.4 L703.3 456.2 L667.7 778.2 L666.9 783.6 L665.7 788.5 L664 793 L661.9 797 L659.4 800.5 L656.4 803.5 L653.1 806.1 L649.3 808.2 L645.1 809.9 L640.5 811.1 L635.4 811.8 L630 812 L394 812 L388.6 811.8 L383.5 811.1 L378.9 809.9 L374.7 808.2 L370.9 806.1 L367.6 803.5 L364.6 800.5 L362.1 797 L360 793 L358.3 788.5 L357.1 783.6 L356.3 778.2 Z";

interface Props {
  size?: number;
  /** "tile" = green rounded tile with white mark; "mark" = white mark only. */
  variant?: "tile" | "mark";
}

export default function AppLogo({ size = 96, variant = "tile" }: Props) {
  const tile = variant === "tile";
  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024">
      {tile && (
        <>
          <Defs>
            <LinearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">
              <Stop offset="0" stopColor="#10b981" />
              <Stop offset="1" stopColor="#047857" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="1024" height="1024" rx="230" fill="url(#bg)" />
        </>
      )}
      <Rect x="282" y="318" width="460" height="66" rx="26" fill="#ffffff" />
      <Rect x="388" y="236" width="48" height="110" rx="24" fill="#ffffff" />
      <Rect x="588" y="236" width="48" height="110" rx="24" fill="#ffffff" />
      <Path d={BODY} fill="#ffffff" />
      <Path
        d="M410 610 L486 686 L624 532"
        stroke="#059669"
        strokeWidth={58}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
