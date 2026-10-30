import { Dimensions, Modal as PhoneModal, useWindowDimensions, View, type ModalProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { modalHeight } from "./sizing";

/** A page or a box over the app. Android keeps one at the size it opened at when a folding phone opens, so what is in it
 *  is given the current size; nothing in it is drawn afresh, so nothing a person is doing is lost. */
export function Modal({ children, ...props }: ModalProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return (
    <PhoneModal {...props}>
      <View testID="modal-body" style={{ width, height: modalHeight(Dimensions.get("screen").height, height, insets.top + insets.bottom) }}>
        {children}
      </View>
    </PhoneModal>
  );
}
