import React from "react";
import { ButtonVariant } from "../components/ui/Button";
import { Label, LabelVariant } from "../components/ui/Label";
import { Modal } from "../components/ui/Modal";

type Mp3CountModalProps = {
  visible: boolean;
  mp3Count: number | null;
  onContinue: () => void;
  onCancel: () => void;
};

export function Mp3CountModal(props: Mp3CountModalProps): React.JSX.Element {
  const { visible, mp3Count, onContinue, onCancel } = props;

  return (
    <Modal
      visible={visible}
      headline="MP3-Dateien"
      buttonConfig={[
        {
          label: "Abbrechen",
          variant: ButtonVariant.Secondary,
          onPress: onCancel,
        },
        {
          label: "Weiter",
          variant: ButtonVariant.Primary,
          onPress: onContinue,
        },
      ]}
      onRequestClose={onCancel}>
      <Label
        title={`Im ausgewählten Ordner wurden ${
          mp3Count ?? 0
        } MP3-Datei(en) gefunden (inkl. Unterordner).`}
        variant={LabelVariant.Normal}
      />
    </Modal>
  );
}
