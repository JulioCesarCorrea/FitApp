# Imagen de la API para Railway (SPEC-deploy-001, ADR-0007).
# El contexto de construcción es la carpeta que prepara deploy/prepare-upload.ps1: src/Api, images/ y este archivo.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/Api/ src/Api/
RUN dotnet publish src/Api/FitnessApp.Api.csproj -c Release -o /out

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /out .
# Imágenes del catálogo (fuera del repositorio; ver la guía de despliegue).
COPY images/ /app/images/
ENV Exercises__ImagesPath=/app/images
# La imagen base ya escucha en el 8080; si la plataforma fija PORT, la API lo usa (ListenUrl).
USER app
ENTRYPOINT ["dotnet", "FitnessApp.Api.dll"]
