import React from "react";
import { ActivityIndicator, Pressable, Text as RNText } from "react-native";
import { Color } from "../../../constants";
import { styles } from "./Button.styles";

export enum ButtonVariant {
  Primary = "primary",
  Secondary = "secondary",
  Tertiary = "tertiary",
  Text = "text",
  Ghost = "ghost",
  Destructive = "destructive",
}

export enum ButtonSize {
  Normal = "normal",
  Small = "small",
}

type ButtonProps = {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  onPress?: () => void;
  disabled?: boolean;
  isLoading?: boolean;
};

export function Button(props: ButtonProps): React.JSX.Element {
  const {
    children,
    variant = ButtonVariant.Primary,
    size = ButtonSize.Normal,
    onPress,
    disabled = false,
    isLoading = false,
  } = props;
  const isDisabled = disabled || isLoading;
  const textStyleByVariant = (() => {
    switch (variant) {
      case ButtonVariant.Secondary:
      case ButtonVariant.Tertiary:
      case ButtonVariant.Ghost:
        return styles.textDark;
      case ButtonVariant.Text:
      case ButtonVariant.Destructive:
      case ButtonVariant.Primary:
      default:
        return styles.textLight;
    }
  })();

  const buttonStyleByVariant = (() => {
    switch (variant) {
      case ButtonVariant.Secondary:
        return styles.buttonSecondary;
      case ButtonVariant.Tertiary:
        return styles.buttonTertiary;
      case ButtonVariant.Text:
        return styles.buttonTextVariant;
      case ButtonVariant.Ghost:
        return styles.buttonGhost;
      case ButtonVariant.Destructive:
        return styles.buttonDestructive;
      case ButtonVariant.Primary:
      default:
        return styles.buttonPrimary;
    }
  })();
  const buttonStyleBySize =
    size === ButtonSize.Small
      ? { paddingVertical: 6, paddingHorizontal: 10 }
      : { paddingVertical: 10, paddingHorizontal: 16 };
  const textStyleBySize =
    size === ButtonSize.Small ? { fontSize: 13 } : { fontSize: 15 };
  const textColor = (() => {
    if (isDisabled) {
      return Color.surfaceLight;
    }
    switch (variant) {
      case ButtonVariant.Secondary:
      case ButtonVariant.Tertiary:
      case ButtonVariant.Ghost:
        return Color.textPrimaryLight;
      case ButtonVariant.Text:
      case ButtonVariant.Destructive:
      case ButtonVariant.Primary:
      default:
        return Color.white;
    }
  })();

  return (
    <Pressable
      style={[
        styles.buttonBase,
        buttonStyleBySize,
        buttonStyleByVariant,
        isDisabled && styles.buttonDisabled,
      ]}
      disabled={isDisabled}
      onPress={onPress}>
      {isLoading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <RNText
          style={[
            styles.textBase,
            textStyleBySize,
            textStyleByVariant,
            isDisabled && styles.textDisabled,
          ]}>
          {children}
        </RNText>
      )}
    </Pressable>
  );
}
