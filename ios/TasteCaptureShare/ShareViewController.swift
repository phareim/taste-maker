import UIKit
import SwiftUI

/// Hosts the SwiftUI capture form. The Share Sheet instantiates this from the
/// extension's Info.plist `NSExtensionPrincipalClass`.
final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()

        let viewModel = CaptureViewModel(extensionContext: extensionContext)
        let host = UIHostingController(rootView: CaptureView(viewModel: viewModel))

        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        host.didMove(toParent: self)
    }
}
