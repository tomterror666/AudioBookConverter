import React from "react";
import { View, ViewStyle } from "react-native";
import { Size, SizePx } from "../../../constants";

type SpacingValue = Size;
type SpacingObject = {
  top?: Size;
  bottom?: Size;
  left?: Size;
  right?: Size;
  inline?: Size;
  block?: Size;
};
type SpacingProp = SpacingValue | SpacingObject;

type BoxProps = {
  children?: React.ReactNode;
  padding?: SpacingProp;
  margin?: SpacingProp;
};

export function Box(props: BoxProps): React.JSX.Element {
  const { children, padding, margin } = props;

  const spacingToStyle = (
    kind: "padding" | "margin",
    value: SpacingProp | undefined,
  ): ViewStyle => {
    if (!value) {
      return {};
    }
    if (typeof value === "string") {
      return { [kind]: SizePx[value] };
    }
    return {
      ...(value.top ? { [`${kind}Top`]: SizePx[value.top] } : null),
      ...(value.bottom ? { [`${kind}Bottom`]: SizePx[value.bottom] } : null),
      ...(value.left ? { [`${kind}Left`]: SizePx[value.left] } : null),
      ...(value.right ? { [`${kind}Right`]: SizePx[value.right] } : null),
      ...(value.inline
        ? {
            [`${kind}Left`]: SizePx[value.inline],
            [`${kind}Right`]: SizePx[value.inline],
          }
        : null),
      ...(value.block
        ? {
            [`${kind}Top`]: SizePx[value.block],
            [`${kind}Bottom`]: SizePx[value.block],
          }
        : null),
    } as ViewStyle;
  };

  const style: ViewStyle = {
    ...spacingToStyle("padding", padding),
    ...spacingToStyle("margin", margin),
  };

  return <View style={style}>{children}</View>;
}
