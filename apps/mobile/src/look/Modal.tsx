import { Modal as PhoneModal, useWindowDimensions, View, type ModalProps } from "react-native";

/** A page or a box over the app. Android keeps one at the size it opened at when a folding phone opens, so what is in it
 *  is given the window's size; nothing in it is drawn afresh, so nothing a person is doing is lost. */
export function Modal({ children, ...props }: ModalProps) {
  const { width, height } = useWindowDimensions();
  return (
    <PhoneModal {...props}>
      <View style={{ width, height }}>{children}</View>
    </PhoneModal>
  );
}
