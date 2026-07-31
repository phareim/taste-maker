import SwiftUI
import TasteCaptureKit

struct CaptureView: View {
    @ObservedObject var viewModel: CaptureViewModel
    @FocusState private var bodyFocused: Bool

    private let kindLabels: [(value: String, label: String)] = [
        ("quote", "Quote"), ("reference", "Reference"), ("music", "Music"),
        ("art", "Art"), ("clothing", "Clothing"),
    ]

    var body: some View {
        NavigationStack {
            Form {
                kindSection
                fieldsSection
                if let message = viewModel.statusMessage {
                    Section {
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(viewModel.statusIsError ? .red : .secondary)
                            .onTapGesture { if viewModel.needsKey { viewModel.openSettings() } }
                    }
                }
            }
            .navigationTitle("Capture")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { viewModel.cancel() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if viewModel.isSubmitting {
                        ProgressView()
                    } else {
                        Button("Save") { Task { await viewModel.submit() } }
                            .disabled(!viewModel.canSubmit)
                    }
                }
            }
        }
        .task {
            await viewModel.loadSharedContent()
            bodyFocused = true
        }
    }

    private var kindSection: some View {
        Section {
            // Wraps to two rows on a phone; none is filled until a kind is
            // settled, which is the visible signal that a choice is needed.
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 8)], spacing: 8) {
                ForEach(kindLabels, id: \.value) { item in
                    let selected = viewModel.kind == item.value
                    Button {
                        viewModel.markTouched(.kind)
                        viewModel.kind = item.value
                    } label: {
                        Text(item.label)
                            .font(.subheadline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            .background(selected ? Color.accentColor : Color.clear)
                            .foregroundStyle(selected ? Color.white : Color.accentColor)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(Color.accentColor.opacity(selected ? 0 : 0.5), lineWidth: 1)
                            )
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 4)

            if let reason = viewModel.kindReason, viewModel.kind != nil {
                caption(reason)
            } else if viewModel.kind == nil && !viewModel.isEnriching {
                caption("Pick a kind to save.")
            }
        } header: {
            HStack {
                Text("Kind")
                if viewModel.isEnriching {
                    Spacer()
                    Text("enriching…").font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
    }

    private var fieldsSection: some View {
        Section {
            LabeledContent("Title") {
                TextField("", text: $viewModel.title)
                    .multilineTextAlignment(.trailing)
                    .onChange(of: viewModel.title) { viewModel.markTouched(.title) }
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(viewModel.bodyLabel).font(.caption).foregroundStyle(.secondary)
                TextField("", text: $viewModel.body, axis: .vertical)
                    .lineLimit(3...8)
                    .focused($bodyFocused)
                    .onChange(of: viewModel.body) { viewModel.markTouched(.body) }
            }

            if viewModel.isImageKind {
                LabeledContent("Image URL") {
                    TextField("", text: $viewModel.imageURL)
                        .multilineTextAlignment(.trailing)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .onChange(of: viewModel.imageURL) { viewModel.markTouched(.imageURL) }
                }
            }

            LabeledContent("Source URL") {
                TextField("", text: $viewModel.sourceURL)
                    .multilineTextAlignment(.trailing)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .onChange(of: viewModel.sourceURL) { viewModel.markTouched(.sourceURL) }
            }

            VStack(alignment: .leading, spacing: 4) {
                LabeledContent(viewModel.creatorLabel) {
                    TextField("", text: $viewModel.creator)
                        .multilineTextAlignment(.trailing)
                        .onChange(of: viewModel.creator) { viewModel.markTouched(.creator) }
                }
                if let source = viewModel.creatorSource, !viewModel.creator.isEmpty {
                    caption("from \(source)")
                }
            }

            LabeledContent("Note") {
                TextField("", text: $viewModel.note)
                    .multilineTextAlignment(.trailing)
                    .onChange(of: viewModel.note) { viewModel.markTouched(.note) }
            }
        }
    }

    private func caption(_ text: String) -> some View {
        Text(text)
            .font(.caption2)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
