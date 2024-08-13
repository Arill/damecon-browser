
class Utilities {
    static updateViewForWindow(view, window, yOffset) {
        const [width, height] = window.getSize()
        view.setBackgroundColor('white');
        view.setBounds({ x: 0, y: yOffset, width: width, height: height - yOffset })
        view.setAutoResize({ width: true, height: true })
        return 
    }
    static hideView(view) {
        view.setAutoResize({ width: false, height: false })
        view.setBounds({ x: -1000, y: 0, width: 0, height: 0 })
    }
}

exports.Utilities = Utilities