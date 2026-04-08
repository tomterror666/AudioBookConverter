import React from "react";
import { ButtonVariant } from "../components/ui/Button";
import { Label, LabelVariant } from "../components/ui/Label";
import { Modal } from "../components/ui/Modal";

type CreateAudiobookM4bModalProps = {
  visible: boolean;
  content: string;
  onClose: () => void;
};

export function CreateAudiobookM4bModal(
  props: CreateAudiobookM4bModalProps,
): React.JSX.Element {
  const { visible, content, onClose } = props;
  return (
    <Modal
      visible={visible}
      headline="Create Audiobook (M4B)"
      buttonConfig={[
        { label: "OK", variant: ButtonVariant.Primary, onPress: onClose },
      ]}
      onRequestClose={onClose}>
      <Label title={content} variant={LabelVariant.Normal} />
    </Modal>
  );
}
