import { type OutputKind, outputName } from "../../call/output";
import MenuSheet from "../../components/MenuSheet";
import { useTheme } from "../../theme";
import OutputIcon from "./OutputIcon";

// The list the Output control opens where the app lists a call's outputs
// itself (Android; iOS shows the system's picker instead): the outputs
// there are now, each by its kind, the one the sound is on checked.
// Picking one moves the sound there and closes the sheet. The list is
// the call's, so a headset that connects or goes while it is open is
// added or taken out, and the check moves with the sound.
export default function OutputSheet({
  outputs,
  current,
  onChoose,
  onClose,
}: {
  outputs: OutputKind[];
  current: OutputKind;
  onChoose: (kind: OutputKind) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  return (
    <MenuSheet
      label="Output"
      closeTestID="voice-output-close"
      items={outputs.map((kind) => ({
        label: outputName({ kind, name: "" }),
        icon: <OutputIcon kind={kind} color={theme.textMuted} size={22} />,
        selected: kind === current,
        testID: `voice-output-${kind}`,
        onPress: () => onChoose(kind),
      }))}
      onClose={onClose}
    />
  );
}
