import React from "react";
import { Text, TextProps, TextStyle } from "react-native";
import { Color } from "../../../constants";
import { styles } from "./Label.styles";

export enum LabelVariant {
  Header1 = "header1",
  Header2 = "header2",
  Header3 = "header3",
  Header4 = "header4",
  Normal = "normal",
  Small = "small",
  NormalBold = "normalBold",
  SmallBold = "smallBold",
}

export enum LabelAlign {
  Left = "left",
  Right = "right",
  Center = "center",
}

type LabelProps = {
  variant: LabelVariant;
  color?: string;
  title: string;
  align?: LabelAlign;
  numberOfLines?: number;
  ellipsizeMode?: TextProps["ellipsizeMode"];
};

function variantStyle(variant: LabelVariant): TextStyle {
  switch (variant) {
    case LabelVariant.Header1:
      return styles.header1;
    case LabelVariant.Header2:
      return styles.header2;
    case LabelVariant.Header3:
      return styles.header3;
    case LabelVariant.Header4:
      return styles.header4;
    case LabelVariant.Small:
      return styles.small;
    case LabelVariant.NormalBold:
      return styles.normalBold;
    case LabelVariant.SmallBold:
      return styles.smallBold;
    case LabelVariant.Normal:
    default:
      return styles.normal;
  }
}

function alignStyle(align: LabelAlign): TextStyle {
  switch (align) {
    case LabelAlign.Right:
      return styles.alignRight;
    case LabelAlign.Center:
      return styles.alignCenter;
    case LabelAlign.Left:
    default:
      return styles.alignLeft;
  }
}

export function Label(props: LabelProps): React.JSX.Element {
  const {
    variant,
    color = Color.black,
    title,
    align = LabelAlign.Left,
    numberOfLines,
    ellipsizeMode,
  } = props;

  return (
    <Text
      numberOfLines={numberOfLines}
      ellipsizeMode={ellipsizeMode}
      style={[
        styles.base,
        variantStyle(variant),
        alignStyle(align),
        { color },
      ]}>
      {title}
    </Text>
  );
}
