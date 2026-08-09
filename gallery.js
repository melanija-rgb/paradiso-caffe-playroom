function renderStack(container, images) {
  if (!container) return;
  container.innerHTML = "";
  images.forEach((img) => {
    const figure = document.createElement("figure");
    figure.className = "gallery__item";
    figure.innerHTML = `<img src="${img.src}" alt="${img.alt}" loading="lazy" />`;
    container.appendChild(figure);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  renderStack(document.getElementById("stack-igraonica"), ParadisoStore.getGalleryBySection("igraonica"));
  renderStack(document.getElementById("stack-dekoracije"), ParadisoStore.getGalleryBySection("dekoracije"));
  renderStack(document.getElementById("stack-kafic"), ParadisoStore.getGalleryBySection("kafic"));
  renderStack(document.getElementById("stack-pica"), ParadisoStore.getGalleryBySection("pica"));
});
