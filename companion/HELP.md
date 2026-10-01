## Ikan Lyra POE Lighting

Controls Ikan Lyra PoE fixtures over Art-Net or sACN.

### Discovery

A single connection manages every fixture on the network. Fixtures are found with an Art-Net poll
(they answer even when set to sACN), and each fixture's DMX address, universe and protocol are then
read from its built-in web interface Set **Poll addresses** to your subnet's broadcast address (or `255.255.255.255`),
and add individual fixture IPs if they are on a different subnet. Separate several addresses with commas.

The network is polled again every **Re-poll every** seconds (0 polls only at startup) to pick up new
fixtures. The **Search for Fixtures** action polls on demand.

### Fixture names

The fixtures don't report their model, so it is taken from the **Device Name** set in each fixture's
web interface. You can rename a fixture freely as long as the name still contains the model (e.g.
`LCX10-POE Key`). If it doesn't, the fixture is still controllable but every control is offered
(CCT, HSI and RGB), whether or not that fixture supports it.

### Protocol

With **Auto** each fixture is driven over whichever protocol it is configured for in its web
interface. Choosing **Art-Net** or **sACN** sends every fixture that protocol instead, so make sure
the fixtures are set to match.

### Value scale

Intensity, saturation, RGB and green/magenta can be entered and shown either as **Percentage**
(green/magenta as -100…+100) or as raw **DMX (0-255)** values. This applies to action options, the
intensity feedback threshold, variables and presets. Changing it does not convert values in actions
you have already set up, so re-check those after switching.

### Choosing fixtures

Most actions and feedbacks apply to **All Fixtures**, or to **Select Fixtures** and then any number
of fixtures from the list. With several fixtures selected, a feedback is only true when it is true
for all of them. **Set Color Mode** and the **Color Mode** feedback only list fixtures that can
switch modes, since fixtures differ in what they support.

### Actions

- **Set Intensity** / **Adjust Intensity**
- **Set Color Temperature** / **Adjust Color Temperature** (limited to each fixture's Kelvin range)
- **Set Green/Magenta**
- **Set Hue / Saturation**
- **Set Red / Green / Blue**
- **Set Color Mode** (CCT, HSI or RGB)
- **Search for Fixtures**

Setting a color temperature, green/magenta, hue/saturation or RGB value also switches the fixture
into the matching color mode.

### Feedbacks

- **Fixture Online** — the fixture answered the most recent poll
- **Color Mode** — the fixture is in the chosen mode
- **Intensity** — the intensity is above a threshold

### Presets

There is a section for **All Fixtures** and one per fixture, ordered by DMX address. Each has
intensity buttons (full, off, ±, and a rotary encoder); All Fixtures adds 3200K and 5600K. Each
fixture also gets color temperature buttons and a rotary encoder, plus color mode, HSI and RGB buttons where the fixture supports them,
and status buttons showing the current values.

### Variables

Per fixture: model/name, IP address, DMX address, universe, protocol, online, color mode,
intensity, color temperature, green/magenta, hue, saturation and red/green/blue. There is also a
count of fixtures found.

### State

These fixtures cannot report their levels back. The variables and feedbacks reflect the last values
this connection sent; if another Art-Net/sACN source drives the same addresses they will drift.
