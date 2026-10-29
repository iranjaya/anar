import type { PlatformTx } from "@anar/db/platform";
import repository from "./repository.js";

const profiles = {
  read(
    tx: PlatformTx,
    userIds: string[],
  ): Promise<{ id: string; name: string; email: string }[]> {
    return repository.readProfiles(tx, userIds);
  },
};
export default profiles;
