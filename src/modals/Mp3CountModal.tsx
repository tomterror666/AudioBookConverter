import React from "react";
import { ButtonVariant } from "../components/ui/Button";
import { Label, LabelVariant } from "../components/ui/Label";
import { Modal } from "../components/ui/Modal";
import { useUiCopy } from "../UiLocaleContext";

type Mp3CountModalProps = {
  visible: boolean;
  mp3Count: number | null;
  onContinue: () => void;
  onCancel: () => void;
};

export function Mp3CountModal(props: Mp3CountModalProps): React.JSX.Element {
  const { visible, mp3Count, onContinue, onCancel } = props;
  const u = useUiCopy();

  return (
    <Modal
      visible={visible}
      headline={u.mp3Modal.headline}
      buttonConfig={[
        {
          label: u.mp3Modal.cancel,
          variant: ButtonVariant.Secondary,
          onPress: onCancel,
        },
        {
          label: u.mp3Modal.continue,
          variant: ButtonVariant.Primary,
          onPress: onContinue,
        },
      ]}
      onRequestClose={onCancel}>
      <Label
        title={u.mp3Modal.fileLine(mp3Count ?? 0)}
        variant={LabelVariant.Normal}
      />
    </Modal>
  );
}
