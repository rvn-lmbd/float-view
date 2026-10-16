# Float View (web)

A tool to view rides recorded with [Float Control] or [Floaty]. I made it so I could easily analyze specific parts of my ride when troubleshooting custom boards, whether I'm using a desktop or mobile device.

Use it here: <https://www.acheron.fail/float-view/>!

Main features:

- Works on Desktop or Mobile devices
- Should be buttery smooth on all devices, even for long rides!
- Ability to highlight parts of the ride when footpad sensors are off or partially off
- Ability to zoom into parts of the map (also zooms the charts!!)
- Can be saved as an applet on mobile devices for offline use
- And more!

## Demo

![demo image of Float View in browser](./.github/demo.jpg)

Also works great on mobile devices:

<img alt="demo image of Float View on mobile" src="./.github/mobile.png" width="35%">

And can be saved as an app to your phone's home screen, by:

1. Opening the website in your browser
2. Clicking the Share button
3. Selecting `Add to Home Screen`

Now you'll have `Float View` all the time, even offline!

## How do I use it?

1. Get on your board and record a ride with [Float Control] or [Floaty]
2. Export your ride data (Float Control will put it in a `.csv.zip`, Floaty in a `.json` or `.csv`)
3. Load it up in <https://acheronfail.github.io/float-view/> (if it's zipped, unzip it first!)
4. Enjoy!

## Floaty elevation correction

Floaty GPS altitudes are converted from WGS84 ellipsoidal heights to approximate elevation above mean sea level using the bundled 15-minute EGM96 geoid grid (`H = h − N`). This correction applies to Floaty JSON/CSV only; Float Control and VESC Tool values are left unchanged because their altitude datum is not established. GPS vertical accuracy and grid resolution limit precision. If the grid cannot load, the ride remains usable with raw altitude and an import warning.

The EGM96 grid is distributed by [GeographicLib](https://geographiclib.sourceforge.io/C++/doc/geoid.html) using [NGA public-domain data](https://github.com/OSGeo/PROJ-data/blob/master/us_nga/us_nga_README.txt).

[Float Control]: https://apps.apple.com/us/app/float-control-vesc-companion/id1590924299
[Floaty]: https://play.google.com/store/apps/details?id=com.floaty.floatyapp&pcampaignid=web_share
