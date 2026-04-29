/**
 * Simple expand/collapse section with a tappable header (title + chevron).
 *
 * @format
 */
import React from "react";
import {
  Pressable,
  StyleProp,
  Text,
  View,
  ViewStyle,
} from "react-native";
import { styles } from "./Accordion.styles";

export type AccordionProps = {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  title: React.ReactNode;
  children: React.ReactNode;
  /** Horizontal space between title block and chevron (default 40). */
  titleChevronGap?: number;
  /** Outer wrapper (e.g. marginTop). */
  style?: StyleProp<ViewStyle>;
  headerStyle?: StyleProp<ViewStyle>;
  panelStyle?: StyleProp<ViewStyle>;
  titleContainerStyle?: StyleProp<ViewStyle>;
};

export function Accordion(props: AccordionProps): React.JSX.Element {
  const {
    expanded,
    onExpandedChange,
    title,
    children,
    titleChevronGap = 40,
    style,
    headerStyle,
    panelStyle,
    titleContainerStyle,
  } = props;

  return (
    <View style={style}>
      <Pressable
        style={({ pressed }) => [
          styles.header,
          headerStyle,
          pressed ? styles.headerPressed : null,
        ]}
        onPress={() => onExpandedChange(!expanded)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}>
        <View style={[styles.titleContainer, titleContainerStyle]}>
          {title}
        </View>
        <View style={{ width: titleChevronGap, flexShrink: 0 }} />
        <Text style={styles.chevron} importantForAccessibility="no">
          {expanded ? "\u25BC" : "\u25B6"}
        </Text>
      </Pressable>
      {expanded ? (
        <View style={[styles.panel, panelStyle]}>{children}</View>
      ) : null}
    </View>
  );
}
