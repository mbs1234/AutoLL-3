import Icon, { IconProps } from './Icon';

/** An arrow leaving a tray. Drawn for this project, on the 16x16 grid `Icon` uses. */
export default function BackupIcon({ ...props }: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 1l-4.5 4.5 1.4 1.4 2.1-2.1v6.2h2v-6.2l2.1 2.1 1.4-1.4zM1 10v5h14v-5h-2v3h-10v-3z" />
    </Icon>
  );
}
