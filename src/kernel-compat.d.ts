// siyuan 1.2.9 predates these request options; present in SiYuan 3.8.9 / current Petal.
import "siyuan/kernel";
declare module "siyuan/kernel" {
    interface IRequestInit { timeout?: number; }
}
