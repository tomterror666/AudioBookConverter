import React from "react";
import { Pressable, Text, View, ViewStyle } from "react-native";
import { Button, ButtonVariant } from "../Button";
import { Box } from "../Box";
import { Size } from "../../../constants";
import { styles } from "./Modal.styles";

export type ModalButtonConfig = {
  label: string;
  variant?: ButtonVariant;
  onPress: () => void;
  disabled?: boolean;
};

type ModalProps = {
  visible: boolean;
  headline?: string;
  onRequestClose?: () => void;
  buttonConfig?: ModalButtonConfig[];
  children?: React.ReactNode;
  cardStyle?: ViewStyle;
};

export function Modal(props: ModalProps): React.JSX.Element | null {
  const {
    visible,
    headline,
    onRequestClose,
    buttonConfig = [],
    children,
    cardStyle,
  } = props;

  if (!visible) {
    return null;
  }

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={onRequestClose} />
      <View style={[styles.card, cardStyle]}>
        {headline ? <Text style={styles.headline}>{headline}</Text> : null}
        {children ? (
          <Box padding={{ block: Size.size_16 }}>{children}</Box>
        ) : null}
        {buttonConfig.length > 0 ? (
          <View style={styles.actionsRow}>
            {buttonConfig.map((cfg, idx) => (
              <Button
                key={`${cfg.label}-${idx}`}
                variant={cfg.variant ?? ButtonVariant.Primary}
                disabled={cfg.disabled}
                onPress={cfg.onPress}>
                {cfg.label}
              </Button>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}
