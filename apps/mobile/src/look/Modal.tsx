import { Modal as PhoneModal, useWindowDimensions, type ModalProps } from "react-native";

/** A page or a box over the app. Android keeps one at the size it opened at when a folding phone opens, so it is drawn
 *  afresh at the new size; a page reads its data again, and what a person is
 *  doing is kept outside it. */
export function Modal(props: ModalProps) {
  const { width, height } = useWindowDimensions();
  return <PhoneModal key={`${String(width)}x${String(height)}`} {...props} />;
}
