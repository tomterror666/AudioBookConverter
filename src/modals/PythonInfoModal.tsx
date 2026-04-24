import React from "react";
import { ScrollView } from "react-native";
import { DependencyStatusPanel } from "../components/DependencyStatusPanel";
import { ButtonVariant } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import type { DependencyCheckResult } from "../utils/dependencyStatus";
import { useUiCopy } from "../UiLocaleContext";
import { styles } from "./PythonInfoModal.styles";

type PythonInfoModalProps = {
  visible: boolean;
  onClose: () => void;
  onDependencyCheckResult: (result: DependencyCheckResult) => void;
};

export function PythonInfoModal(
  props: PythonInfoModalProps,
): React.JSX.Element {
  const { visible, onClose, onDependencyCheckResult } = props;
  const u = useUiCopy();

  return (
    <Modal
      visible={visible}
      onRequestClose={onClose}
      cardStyle={styles.cardWide}
      buttonConfig={[
        {
          label: u.modals.close,
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
