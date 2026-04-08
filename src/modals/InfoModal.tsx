import React from "react";
import { ButtonVariant } from "../components/ui/Button";
import { Label, LabelVariant } from "../components/ui/Label";
import { Modal } from "../components/ui/Modal";

type InfoModalProps = {
  visible: boolean;
  headline: string;
  content: string;
  onClose: () => void;
};

export function InfoModal(props: InfoModalProps): React.JSX.Element {
  const { visible, headline, content, onClose } = props;
  return (
    <Modal
      visible={visible}
      headline={headline}
      buttonConfig={[
        { label: "OK", variant: ButtonVariant.Primary, onPress: onClose },
      ]}
      onRequestClose={onClose}>
      <Label title={content} variant={LabelVariant.Normal} />
    </Modal>
  );
}
