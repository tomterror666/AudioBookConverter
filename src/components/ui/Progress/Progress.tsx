import React from "react";
import { View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { Color, type ColorValue } from "../../../constants";
import { styles } from "./Progress.styles";

export enum ProgressType {
  Circle = "circle",
}

export enum ProgressSize {
  Small = 16,
  Medium = 32,
  Large = 64,
}

/** Ring stroke; fill uses radius `half - STROKE` so it sits concentrically inside the stroke. */
const STROKE_WIDTH = 1;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Circular sector from center, clockwise from 12 o'clock (partial fill only). */
function pieSectorPath(
  cx: number,
  cy: number,
  r: number,
  value: number,
): string | null {
  const v = clamp01(value);
  if (v <= 0) {
    return null;
  }
  if (v >= 1) {
    return null;
  }
  const angle = 2 * Math.PI * v;
  const x1 = cx;
  const y1 = cy - r;
  const x2 = cx + r * Math.sin(angle);
  const y2 = cy - r * Math.cos(angle);
  const largeArc = angle > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
}

type ProgressProps = {
  type?: ProgressType;
  size?: ProgressSize;
  color: ColorValue;
  /** 0 = 0%, 1 = 100% */
  value: number;
};

export function Progress({
  type = ProgressType.Circle,
  size = ProgressSize.Small,
  color,
  value,
}: ProgressProps): React.JSX.Element {
  if (type !== ProgressType.Circle) {
    return <View />;
  }

  const d = size;
  const half = d / 2;
  const rTrack = Math.max(0, half - STROKE_WIDTH / 2);
  const rFill = Math.max(0, half - STROKE_WIDTH);
  const v = clamp01(value);
  const sector = pieSectorPath(half, half, rFill, v);

  return (
    <View style={[styles.root, { width: d, height: d, borderRadius: half }]}>
      <Svg width={d} height={d} pointerEvents="none">
        <Circle
          cx={half}
          cy={half}
          r={rTrack}
          fill={Color.white}
          stroke={Color.black}
          strokeWidth={STROKE_WIDTH}
        />
        {v >= 1 ? (
          <Circle cx={half} cy={half} r={rFill} fill={color} />
        ) : sector != null ? (
          <Path d={sector} fill={color} />
        ) : null}
      </Svg>
    </View>
  );
}
