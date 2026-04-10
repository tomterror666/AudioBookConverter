import React from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Svg, {
  Defs,
  FeGaussianBlur,
  Filter,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";

const VB = 1024;
/** Center-scale motif so it reads smaller on screen (~14% reduction). */
const MOTIF_SCALE = 0.86;
/** Light blur on artwork only (gradient stays sharp). May be a no-op on some platforms. */
const MOTIF_BLUR = 2.0;

/**
 * Full-bleed background matching the app icon: gradient, headphones, open book, accent bars.
 * Renders behind all screen content; does not receive touches.
 */
export function AudiobookScreenBackground(): React.JSX.Element {
  const { width, height } = useWindowDimensions();
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden>
      <Svg
        width={width}
        height={height}
        viewBox={`0 0 ${VB} ${VB}`}
        preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id="asb_bg" x1="6%" y1="4%" x2="94%" y2="96%">
            <Stop offset="0" stopColor="#d8ecf4" />
            <Stop offset="0.45" stopColor="#b2d6e4" />
            <Stop offset="1" stopColor="#8abfcf" />
          </LinearGradient>
          <RadialGradient id="asb_glow" cx="50%" cy="30%" r="52%">
            <Stop offset="0" stopColor="#ffffff" stopOpacity="0.42" />
            <Stop offset="0.5" stopColor="#ffffff" stopOpacity="0.14" />
            <Stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </RadialGradient>
          <LinearGradient id="asb_pageL" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#ffffff" />
            <Stop offset="1" stopColor="#eef6f8" />
          </LinearGradient>
          <LinearGradient id="asb_pageR" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#ffffff" />
            <Stop offset="1" stopColor="#f2f8fa" />
          </LinearGradient>
          <LinearGradient id="asb_cup" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#5a7d8c" />
            <Stop offset="1" stopColor="#3d5c6b" />
          </LinearGradient>
          <LinearGradient id="asb_cupHi" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#8aa9b5" />
            <Stop offset="0.55" stopColor="#6d8e9c" />
            <Stop offset="1" stopColor="#4a6b7a" />
          </LinearGradient>
          <LinearGradient id="asb_accent" x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor="#d4945c" />
            <Stop offset="1" stopColor="#f2c08a" />
          </LinearGradient>
          <Filter id="asb_motifBlur" x="-18%" y="-18%" width="136%" height="136%">
            <FeGaussianBlur stdDeviation={MOTIF_BLUR} />
          </Filter>
        </Defs>
        <Rect width={VB} height={VB} fill="url(#asb_bg)" />
        <Rect width={VB} height={VB} fill="url(#asb_glow)" />
        <G
          filter="url(#asb_motifBlur)"
          transform={`translate(${VB / 2} ${VB / 2}) scale(${MOTIF_SCALE}) translate(${-VB / 2} ${-VB / 2})`}>
          <Path
            d="M 318 378 C 318 278 402 218 512 218 C 622 218 706 278 706 378"
            fill="none"
            stroke="url(#asb_cupHi)"
            strokeWidth={42}
            strokeLinecap="round"
          />
          <Rect
            x={258}
            y={392}
            width={102}
            height={248}
            rx={48}
            ry={48}
            fill="url(#asb_cup)"
          />
          <Rect
            x={664}
            y={392}
            width={102}
            height={248}
            rx={48}
            ry={48}
            fill="url(#asb_cup)"
          />
          <Rect
            x={274}
            y={408}
            width={72}
            height={216}
            rx={36}
            ry={36}
            fill="url(#asb_cupHi)"
            opacity={0.45}
          />
          <Rect
            x={678}
            y={408}
            width={72}
            height={216}
            rx={36}
            ry={36}
            fill="url(#asb_cupHi)"
            opacity={0.45}
          />
          <Path
            d="M 512 302 L 398 318 Q 368 322 352 348 L 352 738 Q 372 718 398 714 L 512 698 Z"
            fill="url(#asb_pageL)"
            opacity={0.98}
          />
          <Path
            d="M 512 302 L 626 318 Q 656 322 672 348 L 672 738 Q 652 718 626 714 L 512 698 Z"
            fill="url(#asb_pageR)"
            opacity={0.99}
          />
          <Path
            d="M 512 302 L 512 698"
            stroke="#3d5c6b"
            strokeOpacity={0.14}
            strokeWidth={9}
            strokeLinecap="round"
          />
          <G transform="translate(512, 518)">
            <Rect
              x={-108}
              y={-36}
              width={30}
              height={72}
              rx={15}
              ry={15}
              fill="url(#asb_accent)"
            />
            <Rect
              x={-62}
              y={-58}
              width={30}
              height={116}
              rx={15}
              ry={15}
              fill="url(#asb_accent)"
              opacity={0.92}
            />
            <Rect
              x={-16}
              y={-44}
              width={30}
              height={88}
              rx={15}
              ry={15}
              fill="url(#asb_accent)"
              opacity={0.88}
            />
            <Rect
              x={30}
              y={-64}
              width={30}
              height={128}
              rx={15}
              ry={15}
              fill="url(#asb_accent)"
              opacity={0.94}
            />
            <Rect
              x={76}
              y={-40}
              width={30}
              height={80}
              rx={15}
              ry={15}
              fill="url(#asb_accent)"
              opacity={0.9}
            />
          </G>
        </G>
      </Svg>
    </View>
  );
}
