// SPDX-License-Identifier: GPL-2.0-only
/*
 * ecofleet-pmic-restart — reboot this board through a BD71847 PMIC cold reset.
 *
 * The normal reset path (PSCI -> TF-A -> WDOG_B) hangs this DART-MX8M-MINI /
 * DT8MCustomBoard before U-Boot SPL: WDOG_B does not make the PMIC power-cycle
 * the DDR/eMMC rails, and only a cold power-cycle recovers. Writing the PMIC's
 * own SWRESET register (0x01 = 0x05: cold reset + trigger) does power-cycle
 * them; gobi-cold-reboot does the same from userspace. See
 * docs/superpowers/plans/2026-09-15-warm-reboot-hang-followup.md.
 *
 * This restart handler runs ahead of PSCI (priority 129) for every reboot:
 * `reboot`, systemctl, and the automatic reboot after a kernel panic. Power-off
 * is not a restart and is untouched. If the write fails, the next handler
 * (PSCI) runs, exactly as before this module.
 */
#include <linux/delay.h>
#include <linux/i2c.h>
#include <linux/module.h>
#include <linux/notifier.h>
#include <linux/reboot.h>

#define PMIC_REG_SWRESET   0x01
#define PMIC_SWRESET_COLD  0x05

static int bus;           /* /dev/i2c-0 = i2c1 @ 0x30a20000 */
module_param(bus, int, 0444);
MODULE_PARM_DESC(bus, "I2C bus number of the BD71847 PMIC");

static int addr = 0x4b;
module_param(addr, int, 0444);
MODULE_PARM_DESC(addr, "I2C address of the BD71847 PMIC");

static struct i2c_adapter *adap;

static int pmic_restart(struct notifier_block *nb, unsigned long mode, void *cmd)
{
	u8 buf[2] = { PMIC_REG_SWRESET, PMIC_SWRESET_COLD };
	struct i2c_msg msg = { .addr = addr, .flags = 0, .len = 2, .buf = buf };
	int ret;

	/*
	 * Interrupts are off here. Call the controller's polling (atomic)
	 * transfer directly: the i2c core only picks it once system_state is
	 * past RUNNING, which is not true on the panic path, and taking the
	 * bus lock could block on a holder that will never run again.
	 */
	if (adap->algo->master_xfer_atomic)
		ret = adap->algo->master_xfer_atomic(adap, &msg, 1);
	else
		ret = i2c_transfer(adap, &msg, 1);

	if (ret != 1) {
		pr_emerg("ecofleet-pmic-restart: PMIC cold reset failed (%d), falling back\n", ret);
		return NOTIFY_DONE;
	}
	mdelay(1000);	/* the PMIC drops the rails well within this */
	pr_emerg("ecofleet-pmic-restart: PMIC did not reset, falling back\n");
	return NOTIFY_DONE;
}

static struct notifier_block pmic_restart_nb = {
	.notifier_call = pmic_restart,
	.priority = 192,	/* ahead of PSCI (129) and imx2-wdt (128) */
};

static int __init pmic_restart_init(void)
{
	int ret;

	adap = i2c_get_adapter(bus);
	if (!adap) {
		pr_err("ecofleet-pmic-restart: no I2C bus %d\n", bus);
		return -ENODEV;
	}
	ret = register_restart_handler(&pmic_restart_nb);
	if (ret) {
		i2c_put_adapter(adap);
		return ret;
	}
	pr_info("ecofleet-pmic-restart: reboots use the PMIC cold reset (i2c-%d 0x%02x)\n",
		bus, addr);
	return 0;
}

static void __exit pmic_restart_exit(void)
{
	unregister_restart_handler(&pmic_restart_nb);
	i2c_put_adapter(adap);
}

module_init(pmic_restart_init);
module_exit(pmic_restart_exit);
MODULE_DESCRIPTION("Reboot via BD71847 PMIC cold reset");
MODULE_LICENSE("GPL");
