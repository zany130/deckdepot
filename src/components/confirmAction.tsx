import { ConfirmModal, showModal } from "@decky/ui";

export function confirmAction(
  title: string,
  description: string
): Promise<boolean> {
  return new Promise((resolve) => {
    let handle: { Close: () => void } | undefined;
    handle = showModal(
      <ConfirmModal
        strTitle={title}
        strDescription={description}
        onOK={() => {
          handle?.Close();
          resolve(true);
        }}
        onCancel={() => {
          handle?.Close();
          resolve(false);
        }}
      />,
      window as unknown as EventTarget
    );
  });
}
