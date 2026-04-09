import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import { DependencyStatusPanel } from "../components/DependencyStatusPanel";
import { ButtonVariant } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import type { DependencyCheckResult } from "../utils/dependencyStatus";

type PythonInfoModalProps = {
  visible: boolean;
  onClose: () => void;
  onDependencyCheckResult: (result: DependencyCheckResult) => void;
};

export function PythonInfoModal(
  props: PythonInfoModalProps,
): React.JSX.Element {
  const { visible, onClose, onDependencyCheckResult } = props;

  return (
    <Modal
      visible={visible}
      onRequestClose={onClose}
      cardStyle={styles.cardWide}
      buttonConfig={[
        {
          label: "Close",
          variant: ButtonVariant.Secondary,
          onPress: onClose,
        },
      ]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator>
        <DependencyStatusPanel onCheckResult={onDependencyCheckResult} />
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  cardWide: {
    maxWidth: 680,
    width: "100%",
  },
  scroll: {
    maxHeight: 520,
  },
  scrollContent: {
    paddingBottom: 8,
  },
});
