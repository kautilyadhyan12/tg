import { Dimensions, Modal as PhoneModal, useWindowDimensions, View, type ModalProps } from "react-native";

/** A page or a box over the app. Android keeps one at the size it opened at when a folding phone opens, so what is in it
 *  is given the current size; nothing in it is drawn afresh, so nothing a person is doing is lost. It is drawn behind the
 *  phone's bars, so it takes the screen's height, which holds them: older Android leaves them out of the window's. */
export function Modal({ children, ...props }: ModalProps) {
  const { width } = useWindowDimensions();
  return (
    <PhoneModal {...props}>
      <View style={{ width, height: Dimensions.get("screen").height }}>{children}</View>
    </PhoneModal>
  );
}
